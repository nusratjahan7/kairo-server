import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import { MongoClient, ServerApiVersion } from "mongodb";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const uri = process.env.MONGODB_URI as string;

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    },
});

async function run() {
    try {
        await client.connect();

        const dbName = process.env.AUTH_DB_NAME;
        const db = client.db(dbName);



        // Ping MongoDB
        await client.db("admin").command({ ping: 1 });

        console.log("✅ Connected to MongoDB");
    } catch (error) {
        console.error(error);
    }
}

run();

app.get("/", (req, res) => {
    res.send("Server is Serving...");
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});