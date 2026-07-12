import express from "express";
import type { Request, Response, NextFunction } from "express";
import dotenv from "dotenv";
import cors from "cors";
import { MongoClient, ObjectId, ServerApiVersion, Collection } from "mongodb";
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

// ========== TYPES ==========
interface AuthUser {
    _id: ObjectId;
    id?: string;
    email?: string;
    role?: "user" | "admin";
    [key: string]: any;
}

interface SessionDoc {
    _id?: ObjectId;
    token: string;
    userId: string | ObjectId;
    [key: string]: any;
}

declare global {
    namespace Express {
        interface Request {
            user?: AuthUser;
        }
    }
}

async function run() {
    try {
        await client.connect();

        const dbName = process.env.AUTH_DB_NAME;
        const db = client.db(dbName);
        const userCollection = db.collection("user");
        const eventCollection = db.collection("events");
        const bookingCollection = db.collection("bookings");
        const sessionCollection: Collection<SessionDoc> = db.collection("session");

        // ========== VERIFY TOKEN ==========
        const verifyToken = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
            try {
                const authHeader = req.headers?.authorization;
                if (!authHeader) {
                    return res.status(401).json({ message: "unauthorized access" });
                }

                const token = authHeader.split(" ")[1];
                if (!token) {
                    return res.status(401).json({ message: "unauthorized access" });
                }

                const session = await sessionCollection.findOne({ token });
                if (!session) {
                    return res.status(401).json({ message: "unauthorized access" });
                }
                const userId =
                    session.userId instanceof ObjectId
                        ? session.userId
                        : ObjectId.isValid(session.userId)
                            ? new ObjectId(session.userId)
                            : null;

                if (!userId) {
                    return res.status(401).json({ message: "unauthorized access" });
                }

                const user = await userCollection.findOne({ _id: userId });
                if (!user) {
                    return res.status(401).json({ message: "unauthorized access" });
                }


                req.user = { ...user, id: user._id.toString() } as AuthUser;
                next();
            } catch (error: any) {
                console.error("Token verification failed:", error);
                return res.status(500).json({ message: "Server error during authentication" });
            }
        };

        // ========== VERIFY USER ==========
        const verifyUser = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
            if (req.user?.role !== "user") {
                return res.status(403).json({ message: "forbidden access" });
            }
            next();
        };

        // ========== VERIFY ADMIN ==========
        const verifyAdmin = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
            if (req.user?.role !== "admin") {
                return res.status(403).json({ message: "forbidden access" });
            }
            next();
        };

        // ========== USER BOOKING API ==========
        app.get('/api/bookings/mine', verifyToken, verifyUser, async (req, res): Promise<any> => {
            try {
                const email = req.query.email as string;
                if (!email) {
                    return res.status(400).json({ success: false, message: "email query param is required" });
                }

                const cursor = bookingCollection
                    .find({ customerEmail: email })
                    .sort({ bookedAt: -1 });
                const result = await cursor.toArray();

                const mapped = result.map((b) => ({
                    ...b,
                    id: b._id.toString(),
                }));

                return res.status(200).json(mapped);
            } catch (error: any) {
                console.error("Error fetching user bookings:", error);
                return res.status(500).json({ success: false, message: "Server Error fetching bookings" });
            }
        });

        // ========== ADMIN USERS API ==========
        app.get('/api/admin/users', verifyToken, verifyAdmin, async (req, res): Promise<any> => {
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

        app.put('/api/admin/users/:id/role', verifyToken, verifyAdmin, async (req, res): Promise<any> => {
            try {
                const id = req.params.id;
                if (typeof id !== "string" || !ObjectId.isValid(id)) {
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

        app.get('/events/:id', verifyToken, async (req, res): Promise<any> => {
            try {
                const id = req.params.id;
                if (typeof id !== "string" || !ObjectId.isValid(id)) {
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

        app.post("/events", verifyToken, verifyAdmin, async (req, res): Promise<any> => {
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

        app.put("/events/:id", verifyToken, verifyAdmin, async (req, res): Promise<any> => {
            try {
                const id = req.params.id;
                if (typeof id !== "string" || !ObjectId.isValid(id)) {
                    return res.status(400).json({ success: false, message: "Invalid Event ID format" });
                }
                const { _id, id: bodyId, ...rest } = req.body;
                const updatedEvent = {
                    ...rest,
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

        app.delete("/events/:id", verifyToken, verifyAdmin, async (req, res): Promise<any> => {
            try {
                const id = req.params.id;
                if (typeof id !== "string" || !ObjectId.isValid(id)) {
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
        app.get('/api/admin/bookings', verifyToken, verifyAdmin, async (req, res): Promise<any> => {
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

        app.get('/api/admin/dashboard', verifyToken, verifyAdmin, async (req, res): Promise<any> => {
            try {
                const totalUsersCount = await userCollection.countDocuments();

                const totalBookingsCount = await bookingCollection.countDocuments({
                    status: { $ne: "cancelled" }
                });

                const revenueAggregation = await bookingCollection.aggregate([
                    { $match: { status: { $ne: "cancelled" } } },
                    { $group: { _id: null, total: { $sum: "$totalPrice" } } }
                ]).toArray();

                const totalRevenueAmount = revenueAggregation[0]?.total || 0;

                const dailyChartData = await bookingCollection.aggregate([
                    { $match: { status: { $ne: "cancelled" } } },
                    {
                        $group: {
                            _id: { $dateToString: { format: "%Y-%m-%d", date: "$bookedAt" } },
                            revenue: { $sum: "$totalPrice" },
                            bookings: { $sum: "$ticketsCount" }
                        }
                    },
                    { $sort: { _id: 1 } },
                    {
                        $project: {
                            _id: 0,
                            date: "$_id",
                            revenue: 1,
                            bookings: 1
                        }
                    }
                ]).toArray();

                return res.status(200).json({
                    totalUsers: {
                        value: totalUsersCount.toLocaleString(),
                        change: "+12% this month"
                    },
                    totalRevenue: {
                        value: `$${totalRevenueAmount.toLocaleString()}`,
                        change: "+24% this month"
                    },
                    totalBookings: {
                        value: totalBookingsCount.toLocaleString(),
                        change: "+18% this month"
                    },
                    chartData: dailyChartData.length > 0 ? dailyChartData : [
                        { date: "No Data", revenue: 0, bookings: 0 }
                    ]
                });

            } catch (error: any) {
                console.error("Error generating admin dashboard analytics:", error);
                return res.status(500).json({
                    success: false,
                    message: "Server Error generating dashboard analytics data"
                });
            }
        });

        app.put('/api/admin/bookings/:id', verifyToken, verifyAdmin, async (req, res): Promise<any> => {
            try {
                const id = req.params.id;
                if (typeof id !== "string" || !ObjectId.isValid(id)) {
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

        app.delete('/api/admin/bookings/:id', verifyToken, verifyAdmin, async (req, res): Promise<any> => {
            try {
                const id = req.params.id;
                if (typeof id !== "string" || !ObjectId.isValid(id)) {
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

        app.post('/api/bookings', verifyToken, async (req, res): Promise<any> => {
            try {
                const { id, eventId, customerEmail, ticketsCount, totalPrice, ...rest } = req.body;

                if (!eventId || !customerEmail) {
                    return res.status(400).json({
                        success: false,
                        message: "eventId and customerEmail are required",
                    });
                }


                const userId = req.user?.id || null;

                const incomingTickets = Number(ticketsCount || 1);
                const incomingPrice = Number(totalPrice);

                const existingBooking = await bookingCollection.findOne({
                    eventId,
                    customerEmail,
                    status: { $ne: "cancelled" },
                });

                if (existingBooking) {
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
                                userId: existingBooking.userId || userId,
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

                const newBooking = {
                    ...rest,
                    eventId,
                    customerEmail,
                    userId,
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

        app.listen(PORT, () => {
            console.log(`🚀 Server running on port ${PORT}`);
        });
    } catch (error) {
        console.error("❌ Failed to start server:", error);
        process.exit(1);
    }
}

run();