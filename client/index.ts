import Application from "@/client";

const app = new Application();
app.app = app;
window.app = app;

app.start();
