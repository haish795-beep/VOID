// 간단한 프론트엔드 스토리지 기반 인증/게시판/버그 리포트 모듈
const VB = (() => {
  const key = k => `vb_${k}`
  const read = k => JSON.parse(localStorage.getItem(key(k))||"null")
  const write = (k,v) => localStorage.setItem(key(k), JSON.stringify(v))

  // 초기 샘플 데이터
  function ensureInit(){
    if(!read('users')) write('users',[{id:1,username:'admin',password:'admin',display:'관리자'}])
    if(!read('currentUser')) write('currentUser',null)
    if(!read('posts')) write('posts',[])
    if(!read('bugs')) write('bugs',[])
    if(!read('rooms')) write('rooms',[
      {id:1,name:'VOID 공식채팅',link:'https://open.kakao.com/o/pqDqhxei',added:'2025-06-03'}
    ])
  }

  // Auth
  function signup(username,password,display){
    const users = read('users')||[]
    if(users.find(u=>u.username===username)) return {ok:false,msg:'이미 존재하는 사용자입니다.'}
    const id = (users.reduce((m,u)=>Math.max(m,u.id),0)||0)+1
    users.push({id,username,password,display})
    write('users',users)
    write('currentUser',{id,username,display})
    return {ok:true}
  }
  function login(username,password){
    const users = read('users')||[]
    const u = users.find(x=>x.username===username && x.password===password)
    if(!u) return {ok:false,msg:'계정 또는 비밀번호가 올바르지 않습니다.'}
    write('currentUser',{id:u.id,username:u.username,display:u.display})
    return {ok:true}
  }
  function logout(){ write('currentUser',null) }
  function currentUser(){ return read('currentUser') }

  // Posts (forum)
  function createPost(title,body,code,author){
    const posts = read('posts')||[]
    const id = (posts.reduce((m,p)=>Math.max(m,p.id),0)||0)+1
    const p = {id,title,body,code,author,created:new Date().toISOString(),comments:[]}
    posts.unshift(p)
    write('posts',posts)
    return p
  }
  function deletePost(id){
    const posts = read('posts')||[]
    const idx = posts.findIndex(p=>p.id==id)
    if(idx===-1) return false
    posts.splice(idx,1)
    write('posts',posts)
    return true
  }
  function getPosts(){ return read('posts')||[] }
  function getPost(id){ return (read('posts')||[]).find(p=>p.id==id) }
  function addComment(postId,author,content){
    const posts = read('posts')||[]
    const p = posts.find(x=>x.id==postId)
    if(!p) return false
    p.comments.push({author,content,created:new Date().toISOString()})
    write('posts',posts)
    return true
  }

  // Bugs
  function reportBug(title,desc,reporter){
    const bugs = read('bugs')||[]
    const id = (bugs.reduce((m,b)=>Math.max(m,b.id),0)||0)+1
    bugs.unshift({id,title,desc,reporter,created:new Date().toISOString(),status:'open'})
    write('bugs',bugs)
    return true
  }
  function getBugs(){ return read('bugs')||[] }

  // Rooms
  function getRooms(){ return read('rooms')||[] }

  ensureInit()
  return {signup,login,logout,currentUser,createPost,getPosts,getPost,addComment,reportBug,getBugs,getRooms}
})()

// DOM 헬퍼 (간단)
function q(sel,ctx=document){return ctx.querySelector(sel)}
function qa(sel,ctx=document){return Array.from(ctx.querySelectorAll(sel))}

// 페이지별 초기화 helpers
function renderNavUser(){
  const user = VB.currentUser()
  const userArea = q('#user-area')
  if(!user) userArea.innerHTML = '<a href="login.html" class="btn">로그인</a>'
  else userArea.innerHTML = `<span class="muted">${user.display||user.username}</span> <a href="#" id="logout-btn" class="btn">로그아웃</a>`
  const logoutBtn = q('#logout-btn')
  if(logoutBtn) logoutBtn.addEventListener('click',e=>{e.preventDefault();VB.logout();location.reload()})
}

function initForumList(){
  const list = q('#posts-list')
  if(!list) return
  const posts = VB.getPosts()
  const user = VB.currentUser() || JSON.parse(localStorage.getItem('vb_currentUser')||'null')
  list.innerHTML = posts.map(p=>{
    const author = escapeHtml((p.author||{}).display||p.author.username||'익명')
    const meta = `<div class="meta">by ${author} · ${new Date(p.created).toLocaleString()}</div>`
    const delBtn = (user && (user.roles && (user.roles.includes('manager')||user.roles.includes('super')) || (user.permissions && user.permissions.delete_all_posts))) ? `<button data-id="${p.id}" class="btn delete-post">삭제</button>` : ''
    return `<article class="post"><h3><a href="post.html?id=${p.id}">${escapeHtml(p.title)}</a></h3>${meta}<p>${escapeHtml(truncate(p.body,160))}</p>${delBtn}</article>`
  }).join('')
  // attach delete handlers
  qa('.delete-post').forEach(b=> b.addEventListener('click', ev=>{
    const id = b.getAttribute('data-id')
    const token = localStorage.getItem('vb_token')
    if(token){
      fetch(`/api/posts/${id}`,{method:'DELETE',headers:{'Authorization':`Bearer ${token}`}})
        .then(res=>{ if(res.ok) location.reload(); else throw new Error('no'); })
        .catch(()=>{ if(confirm('API 삭제 실패 — 로컬에서 삭제하시겠습니까?')){ VB.deletePost(Number(id)); location.reload() } })
    } else {
      if(confirm('로컬에서 삭제하시겠습니까?')){ VB.deletePost(Number(id)); location.reload() }
    }
  }))
}
function initPostView(){
  const id = new URLSearchParams(location.search).get('id')
  const p = VB.getPost(id)
  if(!p){ q('#post-root').innerHTML = '<p>게시글을 찾을 수 없습니다.</p>'; return }
  q('#post-root').innerHTML = `<h1>${escapeHtml(p.title)}</h1><div class="meta">by ${escapeHtml((p.author||{}).display||p.author.username||'익명')} · ${new Date(p.created).toLocaleString()}</div><div class="post-body">${formatBody(p.body)}${p.code?'<pre class="code">'+escapeHtml(p.code)+'</pre>':''}</div>`
  const comments = q('#comments')
  comments.innerHTML = p.comments.map(c=>`<div class="comment"><div class="meta">${escapeHtml(c.author)} · ${new Date(c.created).toLocaleString()}</div><div>${escapeHtml(c.content)}</div></div>`).join('')
  q('#comment-form').addEventListener('submit',e=>{
    e.preventDefault();
    const author = VB.currentUser()?VB.currentUser().display||VB.currentUser().username:'익명'
    const content = q('#comment-content').value.trim()
    if(!content) return alert('댓글 내용을 입력하세요')
    VB.addComment(p.id,author,content)
    location.reload()
  })
  // admin delete button for this post
  const adminArea = q('#post-admin-area')
  if(adminArea){
    const user = VB.currentUser() || JSON.parse(localStorage.getItem('vb_currentUser')||'null')
    if(user && (user.roles && (user.roles.includes('manager')||user.roles.includes('super')) || (user.permissions && user.permissions.delete_all_posts))){
      adminArea.innerHTML = `<button id="delete-this-post" class="btn secondary">이 글 삭제</button>`
      q('#delete-this-post').addEventListener('click',()=>{
        const token = localStorage.getItem('vb_token')
        if(token){
          fetch(`/api/posts/${p.id}`,{method:'DELETE',headers:{'Authorization':`Bearer ${token}`}})
            .then(res=>{ if(res.ok) location.href='forum.html'; else alert('삭제 권한 없음') })
            .catch(()=>{ if(confirm('API 삭제 실패 — 로컬에서 삭제하시겠습니까?')){ VB.deletePost(p.id); location.href='forum.html' } })
        } else {
          if(confirm('로컬에서 삭제하시겠습니까?')){ VB.deletePost(p.id); location.href='forum.html' }
        }
      })
    }
  }
}
function initCreatePost(){
  const form = q('#new-post-form')
  if(!form) return
  form.addEventListener('submit',e=>{
    e.preventDefault()
    const title = q('#post-title').value.trim()
    const body = q('#post-body').value.trim()
    const code = q('#post-code').value.trim()
    if(!title||!body) return alert('제목과 내용을 입력하세요')
    const user = VB.currentUser() || {username:'익명',display:'익명'}
    // Try to send to backend if available, otherwise fallback to local storage
    const payload = {title,body,code,author:{id:user.id,username:user.username,display:user.display}}
    fetch('/api/posts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})
      .then(res=>{
        if(res.ok) return res.json()
        throw new Error('api failed')
      })
      .then(()=> location.href='forum.html')
      .catch(()=>{
        VB.createPost(title,body,code,{id:user.id,username:user.username,display:user.display})
        location.href = 'forum.html'
      })
  })
}
function initBugs(){
  const list = q('#bugs-list')
  const form = q('#bug-form')
  if(list) list.innerHTML = VB.getBugs().map(b=>`<div class="bug"><h4>${escapeHtml(b.title)}</h4><div class="meta">${escapeHtml(b.reporter||'익명')} · ${new Date(b.created).toLocaleString()}</div><p>${escapeHtml(truncate(b.desc,200))}</p></div>`).join('')
  if(form) form.addEventListener('submit',e=>{
    e.preventDefault(); const t=q('#bug-title').value.trim(), d=q('#bug-desc').value.trim(); if(!t||!d) return alert('제목과 내용을 입력하세요'); const r = VB.currentUser()?VB.currentUser().display||VB.currentUser().username:'익명';
    fetch('/api/bugs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:t,desc:d,reporter:r})})
      .then(res=>{ if(res.ok) return res.json(); throw new Error('api') })
      .then(()=> location.reload())
      .catch(()=>{ VB.reportBug(t,d,r); location.reload() })
  })
}
function initCommands(){
  const list=q('#commands-list')
  if(!list) return
  const cmds = [
    {cmd:'추가중',desc:'추가중.'},
  ]
  list.innerHTML = cmds.map(c=>`<div class="cmd"><code>${c.cmd}</code><div class="desc">${c.desc}</div></div>`).join('')
}
function initRooms(){
  const list=q('#rooms-list')
  if(!list) return
  const rooms = VB.getRooms()
  list.innerHTML = rooms.map(r=>`<div class="room"><h4>${escapeHtml(r.name)}</h4><div class="meta">추가: ${new Date(r.added).toLocaleDateString()}</div><a class="btn" href="${r.link}" target="_blank">참여</a></div>`).join('')
}

// Categories & Cafe UI
function getCategories(){
  // simple mock categories — could be dynamic
  return ['전체','공지','스크립트','가이드','질문','자유']
}
function renderCategories(){
  const wrap = q('#category-list')
  if(!wrap) return
  const cats = getCategories()
  wrap.innerHTML = cats.map((c,i)=>`<button data-cat="${c}" class="${i===0? 'active':''}">${c}</button>`).join('')
  qa('#category-list button').forEach(b=> b.addEventListener('click',e=>{
    qa('#category-list button').forEach(x=>x.classList.remove('active'))
    e.currentTarget.classList.add('active')
    filterByCategory(e.currentTarget.getAttribute('data-cat'))
  }))
}

function filterByCategory(cat){
  // for now category filtering is naive: search title or tags
  const all = VB.getPosts()
  const list = q('#posts-list')
  if(!list) return
  const filtered = (cat==='전체')? all : all.filter(p=> (p.tags && p.tags.includes(cat)) || (p.title && p.title.includes(cat)) || (p.body && p.body.includes(cat)) )
  list.innerHTML = filtered.map(p=>renderPostCard(p)).join('')
  attachPostCardHandlers()
}

function renderPostCard(p){
  const author = escapeHtml((p.author||{}).display||p.author.username||'익명')
  const tags = (p.tags||[]).map(t=>`<span class="tag">${escapeHtml(t)}</span>`).join('')
  return `<article class="post"><div class="title"><a href="post.html?id=${p.id}">${escapeHtml(p.title)}</a></div><div class="meta">by ${author} · ${new Date(p.created).toLocaleString()}</div><div class="excerpt">${escapeHtml(truncate(p.body,140))}</div><div class="tags">${tags}</div><div class="actions">${renderPostActions(p)}</div></article>`
}

function renderPostActions(p){
  const user = VB.currentUser() || JSON.parse(localStorage.getItem('vb_currentUser')||'null')
  const delBtn = (user && (user.roles && (user.roles.includes('manager')||user.roles.includes('super')) || (user.permissions && user.permissions.delete_all_posts))) ? `<button data-id="${p.id}" class="btn delete-post">삭제</button>` : ''
  return `${delBtn}`
}

function attachPostCardHandlers(){
  qa('.delete-post').forEach(b=> b.addEventListener('click', ev=>{
    const id = b.getAttribute('data-id')
    const token = localStorage.getItem('vb_token')
    if(token){
      fetch(`/api/posts/${id}`,{method:'DELETE',headers:{'Authorization':`Bearer ${token}`}})
        .then(res=>{ if(res.ok) location.reload(); else throw new Error('no'); })
        .catch(()=>{ if(confirm('API 삭제 실패 — 로컬에서 삭제하시겠습니까?')){ VB.deletePost(Number(id)); location.reload() } })
    } else {
      if(confirm('로컬에서 삭제하시겠습니까?')){ VB.deletePost(Number(id)); location.reload() }
    }
  }))
}

// 유틸
function escapeHtml(s){ if(!s) return ''; return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') }
function truncate(s,n){ return s.length>n? s.slice(0,n)+'...':s }
function formatBody(s){ return '<p>'+escapeHtml(s).replace(/\n/g,'</p><p>')+'</p>' }

// 자동 init
// Mobile nav toggle + simple load animations
function initMobileNav(){
  // inject toggle button into header if not present
  const header = document.querySelector('.site-header .container')
  if(!header) return
  if(!q('.nav-toggle')){
    const btn = document.createElement('button')
    btn.className = 'nav-toggle'
    btn.innerHTML = '<span class="bar"></span><span class="bar"></span><span class="bar"></span>'
    header.insertBefore(btn, header.firstChild)
    btn.addEventListener('click',()=>{
      document.body.classList.toggle('nav-open')
    })
  }
}

function revealOnLoad(){
  // add appear class to elements with .animate-on-load
  requestAnimationFrame(()=>{
    const els = document.querySelectorAll('.animate-on-load')
    els.forEach((el,i)=> setTimeout(()=> el.classList.add('appear'), 90*i))
  })
}

document.addEventListener('DOMContentLoaded',()=>{
  renderNavUser(); initForumList(); initCreatePost(); initBugs(); initCommands(); initRooms(); if(q('#post-root')) initPostView();
  initMobileNav(); revealOnLoad();
})
