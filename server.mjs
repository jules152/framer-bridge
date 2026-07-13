import { connect } from "framer-api"
import http from "http"
import busboy from "busboy"
import { v2 as cloudinary } from "cloudinary"
import fs from "fs"
import path from "path"

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
})

const FRAMER_PROJECT_URL = "https://framer.com/projects/Valoricert--5BxZFOBWwXlA9r1bXaaP-9uUaY"
const COLLECTION_ID = "mm8LhCmM0"
const PORT = process.env.PORT || 3000
const CACHE_FILE = path.join(process.cwd(), "articles.json")

// Lire le cache fichier
function readCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = fs.readFileSync(CACHE_FILE, "utf-8")
      return JSON.parse(data)
    }
  } catch (e) {
    console.error("Erreur lecture cache:", e.message)
  }
  return []
}

// Écrire le cache fichier
function writeCache(articles) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(articles), "utf-8")
    console.log("Cache fichier mis à jour:", articles.length, "articles")
  } catch (e) {
    console.error("Erreur écriture cache:", e.message)
  }
}

async function uploadToCloudinary(imageBuffer) {
  const base64Data = imageBuffer.toString("base64")
  const dataUri = `data:image/png;base64,${base64Data}`
  const result = await cloudinary.uploader.upload(dataUri, { folder: "valoricert" })
  return result.secure_url
}

async function uploadFromUrl(url) {
  const result = await cloudinary.uploader.upload(url, { folder: "valoricert" })
  return result.secure_url
}

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const bb = busboy({ headers: req.headers })
    const fields = {}
    let imageBuffer = null
    bb.on("field", (name, val) => { fields[name] = val })
    bb.on("file", (name, file) => {
      const chunks = []
      file.on("data", chunk => chunks.push(chunk))
      file.on("end", () => { imageBuffer = Buffer.concat(chunks) })
    })
    bb.on("close", () => resolve({ fields, imageBuffer }))
    bb.on("error", reject)
    req.pipe(bb)
  })
}

function parseJSON(req) {
  return new Promise((resolve, reject) => {
    let body = ""
    req.on("data", chunk => body += chunk)
    req.on("end", () => {
      try { resolve(JSON.parse(body)) } catch (e) { reject(e) }
    })
  })
}

function isValidImageBuffer(buf) {
  if (!buf || buf.length < 4) return false
  const hex = buf.slice(0, 4).toString("hex")
  return ["89504e47", "ffd8ffe0", "ffd8ffe1", "47494638", "52494646"].some(sig => hex.startsWith(sig))
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
  res.setHeader("Content-Type", "application/json")

  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return }

  // GET /articles — lecture depuis le fichier JSON local, zéro framer-api
  if (req.method === "GET" && req.url === "/articles") {
    const articles = readCache()
    res.writeHead(200)
    res.end(JSON.stringify(articles))
    return
  }

  // GET /articles/:slug — lecture depuis le fichier JSON local
  if (req.method === "GET" && req.url.startsWith("/articles/")) {
    const slug = req.url.replace("/articles/", "")
    const articles = readCache()
    const item = articles.find(a => a.slug === slug)
    if (!item) { res.writeHead(404); res.end(JSON.stringify({ error: "Not found" })); return }
    res.writeHead(200)
    res.end(JSON.stringify(item))
    return
  }

  // POST /articles — écriture dans Framer CMS via framer-api + mise à jour du fichier JSON
  if (req.method === "POST") {
    try {
      const contentType = req.headers["content-type"] || ""
      let title, slug, content, meta_description, imageBuffer, fields

      if (contentType.includes("multipart/form-data")) {
        const parsed = await parseMultipart(req)
        fields = parsed.fields
        title = fields.title
        slug = fields.slug
        content = fields.content
        meta_description = fields.meta_description || ""
        imageBuffer = parsed.imageBuffer
      } else {
        const body = await parseJSON(req)
        title = body.title
        slug = body.slug
        content = body.content
        meta_description = body.meta_description || ""
        fields = {}
      }

      let imageUrl = ""

      if (isValidImageBuffer(imageBuffer)) {
        console.log("Uploading binary image to Cloudinary...")
        imageUrl = await uploadToCloudinary(imageBuffer)
        console.log("Cloudinary URL:", imageUrl)
      } else if (fields?.image_source_url) {
        console.log("Uploading from URL to Cloudinary:", fields.image_source_url)
        imageUrl = await uploadFromUrl(fields.image_source_url)
        console.log("Cloudinary URL:", imageUrl)
      }

      const framer = await connect(FRAMER_PROJECT_URL, process.env.FRAMER_API_KEY)
      const collections = await framer.getCollections()
      const collection = collections.find(c => c.id === COLLECTION_ID)
      await collection.addItems([{
        slug,
        fieldData: {
          "fWTTnmR7Y": { type: "string", value: title },
          "H4KiIwaFp": { type: "formattedText", value: content },
          "ZXSGuoPfn": { type: "image", value: imageUrl },
          "KahK0D52l": { type: "string", value: meta_description },
          "EOV15THAU": { type: "date", value: new Date().toISOString() }
        }
      }])
      await framer.publish()
      await framer.disconnect()

      // Mettre à jour le fichier JSON local
      const createdAt = new Date().toISOString()
      const newArticle = {
        id: slug,
        slug,
        title,
        content,
        image_url: imageUrl,
        meta_description,
        created_at: createdAt
      }
      const articles = readCache()
      articles.unshift(newArticle)
      writeCache(articles)

      res.writeHead(200)
      res.end(JSON.stringify({ success: true }))
    } catch (err) {
      console.error(err)
      res.writeHead(500)
      res.end(JSON.stringify({ error: err.message }))
    }
    return
  }

  res.writeHead(404)
  res.end(JSON.stringify({ error: "Not found" }))
})

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
  console.log(`Cache fichier: ${CACHE_FILE}`)
  console.log(`Articles en cache: ${readCache().length}`)
})
