import { connect } from "framer-api"
import http from "http"
import busboy from "busboy"
import { v2 as cloudinary } from "cloudinary"

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
})

const FRAMER_PROJECT_URL = "https://framer.com/projects/Valoricert--5BxZFOBWwXlA9r1bXaaP-9uUaY"
const COLLECTION_ID = "mm8LhCmM0"
const PORT = process.env.PORT || 3000

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

  // GET /articles
  if (req.method === "GET" && req.url === "/articles") {
    try {
      const framer = await connect(FRAMER_PROJECT_URL, process.env.FRAMER_API_KEY)
      const collections = await framer.getCollections()
      const collection = collections.find(c => c.id === COLLECTION_ID)
      const items = await collection.getItems()
      await framer.disconnect()
      const articles = items.map(item => ({
        id: item.id,
        slug: item.slug,
        title: item.fieldData["fWTTnmR7Y"]?.value || "",
        content: item.fieldData["H4KiIwaFp"]?.value || "",
        image_url: item.fieldData["ZXSGuoPfn"]?.value || "",
        meta_description: item.fieldData["KahK0D52l"]?.value || "",
        created_at: item.fieldData["EOV15THAU"]?.value || ""
      }))
      res.writeHead(200)
      res.end(JSON.stringify(articles))
    } catch (err) {
      console.error(err)
      res.writeHead(500)
      res.end(JSON.stringify({ error: err.message }))
    }
    return
  }

  // GET /articles/:slug
  if (req.method === "GET" && req.url.startsWith("/articles/")) {
    const slug = req.url.replace("/articles/", "")
    try {
      const framer = await connect(FRAMER_PROJECT_URL, process.env.FRAMER_API_KEY)
      const collections = await framer.getCollections()
      const collection = collections.find(c => c.id === COLLECTION_ID)
      const items = await collection.getItems()
      await framer.disconnect()
      const item = items.find(i => i.slug === slug)
      if (!item) { res.writeHead(404); res.end(JSON.stringify({ error: "Not found" })); return }
      res.writeHead(200)
      res.end(JSON.stringify({
        id: item.id,
        slug: item.slug,
        title: item.fieldData["fWTTnmR7Y"]?.value || "",
        content: item.fieldData["H4KiIwaFp"]?.value || "",
        image_url: item.fieldData["ZXSGuoPfn"]?.value || "",
        meta_description: item.fieldData["KahK0D52l"]?.value || "",
        created_at: item.createdTime || ""
      }))
    } catch (err) {
      res.writeHead(500)
      res.end(JSON.stringify({ error: err.message }))
    }
    return
  }

  // POST /articles
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
          "KahK0D52l": { type: "string", value: meta_description }
        }
      }])
      await framer.publish()
      await framer.disconnect()

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

server.listen(PORT, () => console.log(`Server running on port ${PORT}`))
