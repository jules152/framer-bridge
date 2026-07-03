import { connect } from "framer-api"
import http from "http"

const FRAMER_PROJECT_URL = "https://framer.com/projects/Valoricert--5BxZFOBWwXlA9r1bXaaP-9uUaY"
const COLLECTION_ID = "mm8LhCmM0"
const PORT = process.env.PORT || 3000

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
  res.setHeader("Content-Type", "application/json")

  if (req.method === "OPTIONS") {
    res.writeHead(204)
    res.end()
    return
  }

  // GET /articles → retourne tous les articles du CMS
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
        title: item.fieldData["fWTTnmR7Y"] || "",
        content: item.fieldData["H4KiIwaFp"] || ""
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

  // POST / → ajoute un article
  if (req.method === "POST") {
    let body = ""
    req.on("data", chunk => body += chunk)
    req.on("end", async () => {
      try {
        const { title, slug, content } = JSON.parse(body)
        const framer = await connect(FRAMER_PROJECT_URL, process.env.FRAMER_API_KEY)
        const collections = await framer.getCollections()
        const collection = collections.find(c => c.id === COLLECTION_ID)

        await collection.addItems([{
          slug,
          fieldData: {
            "fWTTnmR7Y": { type: "string", value: title },
            "H4KiIwaFp": { type: "formattedText", value: content }
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
    })
    return
  }

  res.writeHead(404)
  res.end(JSON.stringify({ error: "Not found" }))
})

server.listen(PORT, () => console.log(`Server running on port ${PORT}`))
