declare namespace Express {
    interface Request {
        rawBody?: Buffer;
        files?: Record<string, any>;
    }
}
