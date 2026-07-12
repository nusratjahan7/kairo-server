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


app.get("/", (req, res) => {
    res.send("Server is Serving...");
});

async function run() {
    try {
        await client.connect();

        const dbName = process.env.AUTH_DB_NAME;
        const db = client.db(dbName);
        const userCollection = db.collection("user");
        const eventCollection = db.collection("events");
        const bookingCollection = db.collection("bookings");

        // ========== ADMIN USERS API ==========
        app.get('/api/admin/users', async (req, res): Promise<any> => {
            try {
                const cursor = userCollection.find().sort({ createdAt: -1 });
                const result = await cursor.toArray();

                const mapped = result.map((u) => ({
                    id: u._id.toString(),
                    name: u.name || "Unnamed User",
                    email: u.email,
                    role: u.role || "user",
                    emailVerified: u.emailVerified || false,
                    image: u.image || null,
                    createdAt: u.createdAt,
                }));

                return res.status(200).json(mapped);
            } catch (error: any) {
                console.error("Error fetching users:", error);
                return res.status(500).json({ success: false, message: "Server Error fetching users" });
            }
        });

        app.put('/api/admin/users/:id/role', async (req, res): Promise<any> => {
            try {
                const id = req.params.id;
                if (!ObjectId.isValid(id)) {
                    return res.status(400).json({ success: false, message: "Invalid User ID format" });
                }

                const { role } = req.body;
                if (!role || !["user", "admin"].includes(role)) {
                    return res.status(400).json({ success: false, message: "Invalid role value" });
                }

                const result = await userCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { role, updatedAt: new Date() } }
                );

                if (result.matchedCount === 0) {
                    return res.status(404).json({ success: false, message: "User not found" });
                }

                return res.status(200).json({
                    success: true,
                    message: `User role updated to ${role} successfully`,
                });
            } catch (error: any) {
                console.error("Error updating user role:", error);
                return res.status(500).json({ success: false, error: error.message });
            }
        });

        // ========== EVENTS API ==========
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

        app.put("/events/:id", async (req, res): Promise<any> => {
            try {
                const id = req.params.id;
                if (!ObjectId.isValid(id)) {
                    return res.status(400).json({ success: false, message: "Invalid Event ID format" });
                }
                const updatedEvent = {
                    ...req.body,
                    dateTime: req.body.dateTime ? new Date(req.body.dateTime) : undefined,
                    price: req.body.price !== undefined ? Number(req.body.price) : undefined,
                    capacity: req.body.capacity !== undefined ? Number(req.body.capacity) : undefined,
                    updatedAt: new Date()
                };
                Object.keys(updatedEvent).forEach(key => (updatedEvent as any)[key] === undefined && delete (updatedEvent as any)[key]);
                const result = await eventCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: updatedEvent }
                );
                if (result.matchedCount === 0) {
                    return res.status(404).json({ success: false, message: "Event not found" });
                }
                return res.status(200).json({ success: true, message: "Event updated successfully" });
            } catch (error: any) {
                return res.status(500).json({ success: false, error: error.message });
            }
        });

        app.delete("/events/:id", async (req, res): Promise<any> => {
            try {
                const id = req.params.id;
                if (!ObjectId.isValid(id)) {
                    return res.status(400).json({ success: false, message: "Invalid Event ID format" });
                }
                const result = await eventCollection.deleteOne({ _id: new ObjectId(id) });
                if (result.deletedCount === 0) {
                    return res.status(404).json({ success: false, message: "Event not found" });
                }
                return res.status(200).json({ success: true, message: "Event deleted successfully" });
            } catch (error: any) {
                return res.status(500).json({ success: false, error: error.message });
            }
        });

        // ========== ADMIN BOOKINGS API ==========
        app.get('/api/admin/bookings', async (req, res): Promise<any> => {
            try {
                const cursor = bookingCollection.find().sort({ bookedAt: -1 });
                const result = await cursor.toArray();


                const mapped = result.map((b) => ({
                    ...b,
                    id: b._id.toString(),
                }));

                return res.status(200).json(mapped);
            } catch (error: any) {
                console.error("Error fetching bookings:", error);
                return res.status(500).json({ success: false, message: "Server Error fetching bookings" });
            }
        });

        app.put('/api/admin/bookings/:id', async (req, res): Promise<any> => {
            try {
                const id = req.params.id;
                if (!ObjectId.isValid(id)) {
                    return res.status(400).json({ success: false, message: "Invalid Booking ID format" });
                }
                const { status } = req.body;
                if (!status || !["confirmed", "pending", "cancelled"].includes(status)) {
                    return res.status(400).json({ success: false, message: "Invalid status value" });
                }
                const result = await bookingCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { status, updatedAt: new Date() } }
                );
                if (result.matchedCount === 0) {
                    return res.status(404).json({ success: false, message: "Booking not found" });
                }
                return res.status(200).json({ success: true, message: "Booking status updated successfully" });
            } catch (error: any) {
                console.error("Error updating booking status:", error);
                return res.status(500).json({ success: false, error: error.message });
            }
        });

        app.delete('/api/admin/bookings/:id', async (req, res): Promise<any> => {
            try {
                const id = req.params.id;
                if (!ObjectId.isValid(id)) {
                    return res.status(400).json({ success: false, message: "Invalid Booking ID format" });
                }
                const result = await bookingCollection.deleteOne({ _id: new ObjectId(id) });
                if (result.deletedCount === 0) {
                    return res.status(404).json({ success: false, message: "Booking not found" });
                }
                return res.status(200).json({ success: true, message: "Booking deleted successfully" });
            } catch (error: any) {
                console.error("Error deleting booking:", error);
                return res.status(500).json({ success: false, error: error.message });
            }
        });

        app.post('/api/bookings', async (req, res): Promise<any> => {
            try {

                const { id, eventId, customerEmail, ticketsCount, totalPrice, ...rest } = req.body;

                if (!eventId || !customerEmail) {
                    return res.status(400).json({
                        success: false,
                        message: "eventId and customerEmail are required",
                    });
                }

                const incomingTickets = Number(ticketsCount || 1);
                const incomingPrice = Number(totalPrice);


                const existingBooking = await bookingCollection.findOne({
                    eventId,
                    customerEmail,
                    status: { $ne: "cancelled" },
                });

                if (existingBooking) {
                    // পুরনো booking-এই ticketsCount আর totalPrice যোগ করা হচ্ছে
                    const updatedTicketsCount =
                        (existingBooking.ticketsCount || 0) + incomingTickets;
                    const updatedTotalPrice =
                        (existingBooking.totalPrice || 0) + incomingPrice;

                    await bookingCollection.updateOne(
                        { _id: existingBooking._id },
                        {
                            $set: {
                                ticketsCount: updatedTicketsCount,
                                totalPrice: updatedTotalPrice,
                                status: "confirmed",
                                updatedAt: new Date(),
                            },
                        },
                    );

                    return res.status(200).json({
                        success: true,
                        id: existingBooking._id.toString(),
                        merged: true,
                        ticketsCount: updatedTicketsCount,
                    });
                }

                // এই ইউজারের এই ইভেন্টে এটাই প্রথম বুকিং — নতুন document তৈরি
                const newBooking = {
                    ...rest,
                    eventId,
                    customerEmail,
                    ticketsCount: incomingTickets,
                    totalPrice: incomingPrice,
                    status: rest.status || "confirmed",
                    bookedAt: new Date(),
                };

                const result = await bookingCollection.insertOne(newBooking);

                return res.status(201).json({
                    success: true,
                    result,
                    id: result.insertedId.toString(),
                    merged: false,
                });
            } catch (error: any) {
                console.error("Error creating booking:", error);
                return res.status(500).json({ success: false, error: error.message });
            }
        });

        // ========== STRIPE CHECKOUT ==========
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

        // 🆕 এখন routes সব registered হওয়ার পরেই সার্ভার listen শুরু করে
        app.listen(PORT, () => {
            console.log(`🚀 Server running on port ${PORT}`);
        });
    } catch (error) {
        console.error("❌ Failed to start server:", error);
        process.exit(1);
    }
}

run();