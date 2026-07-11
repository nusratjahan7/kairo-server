import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import { MongoClient, ObjectId, ServerApiVersion } from "mongodb";
import Stripe from "stripe";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);


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

        // =========================================================
        // EVENTS API 
        // ========================================================= 

        app.get('/events', async (req, res): Promise<any> => {
            const cursor = eventCollection.find();
            const result = await cursor.toArray();
            res.send(result);
        });

        app.get('/events/:id', async (req, res): Promise<any> => {
            try {
                const id = req.params.id;
                if (!id || !ObjectId.isValid(id)) {
                    return res.status(400).json({ success: false, message: "Invalid Event ID format" });
                }

                const query = { _id: new ObjectId(id) };

                const event = await eventCollection.findOne(query);

                if (!event) {
                    return res.status(404).json({ success: false, message: "Event not found" });
                }

                return res.status(200).json({ success: true, data: event });
            } catch (error: any) {
                console.error("Error fetching event details:", error);
                return res.status(500).json({ success: false, message: "Invalid ID format or Server Error" });
            }
        });

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

        // =========================================================
        //  STRIPE CHECKOUT SESSION ROUTE 
        // =========================================================
        app.post("/create-checkout-session", async (req, res): Promise<any> => {
            try {
                const { eventId, title, price, imageUrl } = req.body;


                if (!title || price === undefined || price === null) {
                    return res.status(400).json({ error: "Missing required fields: title or price" });
                }

                const parsedPrice = Number(price);
                if (parsedPrice <= 0) {
                    return res.status(400).json({
                        error: "Free events cannot be processed through Stripe. Please handle registration directly."
                    });
                }

                const frontendUrl = process.env.FRONTEND_URL || req.headers.origin || "http://localhost:3000";


                const validImages = imageUrl && imageUrl.startsWith("http") ? [imageUrl] : [];


                const session = await stripe.checkout.sessions.create({
                    payment_method_types: ["card"],
                    line_items: [
                        {
                            price_data: {
                                currency: "usd",
                                product_data: {
                                    name: title,
                                    images: validImages,
                                    metadata: {
                                        eventId: eventId || "",
                                    }
                                },
                                unit_amount: Math.round(parsedPrice * 100),
                            },
                            quantity: 1,
                        },
                    ],
                    mode: "payment",
                    success_url: `${frontendUrl}/payment-success?session_id={CHECKOUT_SESSION_ID}&eventId=${eventId}`,
                    cancel_url: `${frontendUrl}/events/${eventId}?canceled=true`,
                });


                return res.status(200).json({ id: session.id, url: session.url });

            } catch (error: any) {


                return res.status(500).json({
                    success: false,
                    error: error.message || "Internal Server Error during checkout generation"
                });
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