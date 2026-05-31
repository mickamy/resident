// Top-level fatal-error handlers. Importing this first ensures the handlers are
// installed before any other module's top-level code runs, so a throw during
// ESM module evaluation is still surfaced through this path.
//
// Log the stack only (not the whole reason object) — SDK errors can carry
// Authorization headers and other secrets in nested properties.
const handleFatal = (label: string, error: unknown) => {
  let formatted: string;
  if (error instanceof Error) {
    formatted = error.stack ?? error.message;
  } else if (typeof error === "object" && error !== null) {
    const obj = error as Record<string, unknown>;
    formatted =
      typeof obj.stack === "string"
        ? obj.stack
        : typeof obj.message === "string"
          ? obj.message
          : String(error);
  } else {
    formatted = String(error);
  }
  console.error(`resident: ${label}:`, formatted);
  process.exit(1);
};

process.on("uncaughtException", (error) => handleFatal("uncaughtException", error));
process.on("unhandledRejection", (reason) => handleFatal("unhandledRejection", reason));
