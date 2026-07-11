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
        const eventCollection = db.collection("events");

        // EVENTS 

        app.get('/events', async (req, res): Promise<any> => {
            const cursor = eventCollection.find();
            const result = await cursor.toArray();
            res.send(result);
        })

        app.post("/events", async (req, res): Promise<any> => {
            try {
                const newEvent = {
                    ...req.body,
                    dateTime: new Date(req.body.dateTime),
                    price: Number(req.body.price),
                    capacity: Number(req.body.capacity),
                    createdAt: new Date()
                };

                const result = await eventCollection.insertOne(newEvent);

                return res.status(201).json({ success: true, result });
            } catch (error) {
                return res.status(500).json({ success: false, error });
            }
        });

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