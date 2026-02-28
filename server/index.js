const express = require('express')
const cors = require('cors')
const fs = require('fs')
const path = require('path')
const multer = require('multer')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')

const app = express()
const PORT = process.env.PORT || 3000
const DB_FILE = path.join(__dirname,'db.json')
const UPLOAD_DIR = path.join(__dirname,'uploads')
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-please'

if(!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR)

app.use(cors())
app.use(express.json())
app.use(express.urlencoded({extended:true}))

// serve the frontend (parent folder = bot-site)
app.use('/', express.static(path.join(__dirname,'..')))
app.use('/uploads', express.static(UPLOAD_DIR))

function loadDB(){
  try{ return JSON.parse(fs.readFileSync(DB_FILE,'utf8')) } catch(e){ return {users:[],posts:[],bugs:[],rooms:[]} }
}
function saveDB(db){ fs.writeFileSync(DB_FILE, JSON.stringify(db,null,2),'utf8') }

// ensure special user 'haish' exists with elevated permissions
function ensureHaish(){
  const db = loadDB()
  let existing = db.users.find(u=>u.username==='haish')
  if(!existing){
    const id = (db.users.reduce((m,u)=>Math.max(m,u.id),0)||0)+1
    const password = 'haish' // default password — change after first login
    const hash = bcrypt.hashSync(password,10)
    const user = {id,username:'haish',password:hash,display:'haish',roles:['manager','admin','super'],permissions:{delete_all_posts:true}}
    db.users.push(user)
    saveDB(db)
    console.log('Created default user haish with password "haish" — change it ASAP')
    return
  }
  // ensure existing haish has elevated roles/permissions
  let changed = false
  if(!existing.roles || !Array.isArray(existing.roles) || !existing.roles.includes('super')){
    existing.roles = Array.from(new Set([...(existing.roles||[]),'manager','admin','super']))
    changed = true
  }
  if(!existing.permissions || !existing.permissions.delete_all_posts){
    existing.permissions = Object.assign({}, existing.permissions || {}, {delete_all_posts:true})
    changed = true
  }
  if(changed){
    // update db
    const idx = db.users.findIndex(u=>u.username==='haish')
    if(idx!==-1) db.users[idx] = existing
    saveDB(db)
    console.log('Updated existing user haish with elevated roles/permissions')
  }
}
ensureHaish()

function authMiddleware(req,res,next){
  const h = req.headers.authorization
  if(!h) return res.status(401).json({ok:false,msg:'no auth'})
  const parts = h.split(' ')
  if(parts.length!==2) return res.status(401).json({ok:false,msg:'bad auth'})
  const token = parts[1]
  try{
    const decoded = jwt.verify(token, JWT_SECRET)
    req.user = decoded
    next()
  }catch(e){ return res.status(401).json({ok:false,msg:'invalid token'}) }
}

app.get('/api/ping',(req,res)=>res.json({ok:true}))

// auth
app.post('/api/auth/signup',(req,res)=>{
  const {username,password,display} = req.body
  if(!username||!password) return res.status(400).json({ok:false,msg:'missing'})
  const db = loadDB()
  if(db.users.find(u=>u.username===username)) return res.status(400).json({ok:false,msg:'exists'})
  const id = (db.users.reduce((m,u)=>Math.max(m,u.id),0)||0)+1
  const hash = bcrypt.hashSync(password,10)
  const user = {id,username,password:hash,display:display||username,roles:[],permissions:{}}
  db.users.push(user)
  saveDB(db)
  const token = jwt.sign({id:user.id,username:user.username,display:user.display,roles:user.roles,permissions:user.permissions}, JWT_SECRET)
  res.json({ok:true,user:{id:user.id,username:user.username,display:user.display,roles:user.roles,permissions:user.permissions},token})
})

app.post('/api/auth/login',(req,res)=>{
  const {username,password} = req.body
  const db = loadDB()
  const u = db.users.find(x=>x.username===username)
  if(!u) return res.status(400).json({ok:false,msg:'invalid'})
  if(!bcrypt.compareSync(password,u.password)) return res.status(400).json({ok:false,msg:'invalid'})
  const token = jwt.sign({id:u.id,username:u.username,display:u.display,roles:u.roles||[],permissions:u.permissions||{}}, JWT_SECRET)
  res.json({ok:true,user:{id:u.id,username:u.username,display:u.display,roles:u.roles||[],permissions:u.permissions||{}},token})
})

// posts
app.get('/api/posts',(req,res)=>{
  const db = loadDB()
  res.json({ok:true,posts:db.posts})
})
app.post('/api/posts',(req,res)=>{
  const db = loadDB()
  const {title,body,code,author} = req.body
  if(!title||!body) return res.status(400).json({ok:false,msg:'missing'})
  const id = (db.posts.reduce((m,p)=>Math.max(m,p.id),0)||0)+1
  const p = {id,title,body,code,author,created:new Date().toISOString(),comments:[]}
  db.posts.unshift(p)
  saveDB(db)
  res.json({ok:true,post:p})
})

// delete single post — requires auth: author or manager/super or permission
app.delete('/api/posts/:id', authMiddleware, (req,res)=>{
  const db = loadDB()
  const pid = Number(req.params.id)
  const idx = db.posts.findIndex(p=>p.id===pid)
  if(idx===-1) return res.status(404).json({ok:false,msg:'not found'})
  const post = db.posts[idx]
  const user = db.users.find(u=>u.id===req.user.id)
  const canDelete = (user && ((user.permissions && user.permissions.delete_all_posts) || (user.roles && (user.roles.includes('manager')||user.roles.includes('super'))))) || (post.author && post.author.id && post.author.id===req.user.id)
  if(!canDelete) return res.status(403).json({ok:false,msg:'forbidden'})
  db.posts.splice(idx,1)
  saveDB(db)
  res.json({ok:true})
})

// delete all posts — super/permission only
app.delete('/api/posts', authMiddleware, (req,res)=>{
  const db = loadDB()
  const user = db.users.find(u=>u.id===req.user.id)
  if(!(user && ((user.permissions && user.permissions.delete_all_posts) || (user.roles && user.roles.includes('super'))))) return res.status(403).json({ok:false,msg:'forbidden'})
  db.posts = []
  saveDB(db)
  res.json({ok:true})
})

// bugs
app.get('/api/bugs',(req,res)=>{ const db=loadDB(); res.json({ok:true,bugs:db.bugs}) })
app.post('/api/bugs',(req,res)=>{
  const db=loadDB(); const {title,desc,reporter}=req.body
  if(!title||!desc) return res.status(400).json({ok:false,msg:'missing'})
  const id=(db.bugs.reduce((m,b)=>Math.max(m,b.id),0)||0)+1
  const b={id,title,desc,reporter,created:new Date().toISOString(),status:'open'}
  db.bugs.unshift(b); saveDB(db); res.json({ok:true,bug:b})
})

// rooms
app.get('/api/rooms',(req,res)=>{ const db=loadDB(); res.json({ok:true,rooms:db.rooms}) })
app.post('/api/rooms',(req,res)=>{ const db=loadDB(); const {name,link,added}=req.body; const id=(db.rooms.reduce((m,r)=>Math.max(m,r.id),0)||0)+1; const r={id,name,link,added:added||new Date().toISOString()}; db.rooms.push(r); saveDB(db); res.json({ok:true,room:r}) })

// uploads
const storage = multer.diskStorage({ destination: (req,file,cb)=>cb(null, UPLOAD_DIR), filename:(req,file,cb)=>{ const fn = Date.now()+"-"+file.originalname.replace(/[^a-z0-9.\-\_]/ig,''); cb(null,fn) } })
const upload = multer({storage})
app.post('/api/upload', upload.single('file'), (req,res)=>{
  if(!req.file) return res.status(400).json({ok:false,msg:'no file'})
  const url = `/uploads/${req.file.filename}`
  res.json({ok:true,url})
})

app.listen(PORT,()=>console.log(`VOID BOT server running on http://localhost:${PORT}`))
