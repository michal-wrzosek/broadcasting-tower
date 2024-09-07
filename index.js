const v8 = require("node:v8");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const express = require("express");
const { z } = require("zod");
const { version } = require("./package.json");

const app = express();

const configSchema = z.object({
  PORT: z
    .literal("")
    .transform(() => undefined)
    .or(z.coerce.number().int().positive())
    .default(3000),
  MAX_NUMBER_OF_MESSAGES_PER_QUERY: z
    .literal("")
    .transform(() => undefined)
    .or(z.coerce.number().int().positive())
    .default(1000),
  MAX_MESSAGE_SIZE_IN_BYTES: z
    .literal("")
    .transform(() => undefined)
    .or(z.coerce.number().int().positive())
    // 10kB
    .default(10_000),
  MAX_CACHE_SIZE_IN_BYTES: z
    .literal("")
    .transform(() => undefined)
    .or(z.coerce.number().int().positive())
    // 1GB
    .default(1 * 1_000 * 1_000 * 1_000),
});

const config = configSchema.parse({
  PORT: process.env.PORT,
  MAX_NUMBER_OF_MESSAGES_PER_QUERY:
    process.env.MAX_NUMBER_OF_MESSAGES_PER_QUERY,
  MAX_MESSAGE_SIZE_IN_BYTES: process.env.MAX_MESSAGE_SIZE_IN_BYTES,
  MAX_CACHE_SIZE_IN_BYTES: process.env.MAX_CACHE_SIZE_IN_BYTES,
});

// Checking the actual available memory size
// You can control it with node flag --max-old-space-size=
const maxHeapSizeInBytes = v8.getHeapStatistics().heap_size_limit;

// max 80% of the available memory
const finalMaxCacheSizeInBytes = Math.min(
  config.MAX_CACHE_SIZE_IN_BYTES,
  maxHeapSizeInBytes * 0.8
);

const errorMessage = "failure";

const cache = [];
let cacheSizeInBytes = 0;

const formatCacheEntry = ([timestamp, messageText]) =>
  `${timestamp}|${messageText}`;

// 8 bytes for timestamp that we keep for each message
const additionalCacheEntrySizeInBytes = 8;

const getCacheEntrySizeInBytes = ([, messageText]) =>
  Buffer.byteLength(messageText, "utf8") + additionalCacheEntrySizeInBytes;

const checkMaxByteLength = (maxByteLength) => (val) =>
  Buffer.byteLength(val, "utf8") <= maxByteLength;

// Replacing the version in the index.html
const indexHtml = readFileSync(path.join(__dirname, "/index.html"), "utf8");

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.get("/", (_req, res) => {
  res.send(
    indexHtml
      .replace(/{{VERSION}}/g, version)
      .replace(/{{MESSAGES_STORED}}/g, String(cache.length))
      .replace(/{{MESSAGES_STORED_SIZE}}/g, String(cacheSizeInBytes))
      .replace(
        /{{MESSAGES_STORED_SIZE_LIMIT}}/g,
        finalMaxCacheSizeInBytes.toFixed(0)
      )
      .replace(
        /{{MESSAGES_PER_SECOND}}/g,
        (cache.length > 0 && cache[0][0] - cache[cache.length - 1][0] > 0
          ? cache.length / (cache[0][0] - cache[cache.length - 1][0])
          : 0
        ).toFixed(4)
      )
      .replace(
        /{{MAX_MESSAGE_SIZE_IN_BYTES}}/g,
        config.MAX_MESSAGE_SIZE_IN_BYTES
      )
      .replace(
        /{{MAX_NUMBER_OF_MESSAGES_PER_QUERY}}/g,
        config.MAX_NUMBER_OF_MESSAGES_PER_QUERY
      )
  );
});

const messagesQuerySchema = z.object({
  startsWith: z
    .string()
    .refine(checkMaxByteLength(config.MAX_MESSAGE_SIZE_IN_BYTES))
    .optional(),
  timestampFrom: z
    .literal("")
    .transform(() => undefined)
    .or(z.coerce.number().int())
    .optional(),
  timestampTo: z
    .literal("")
    .transform(() => undefined)
    .or(z.coerce.number().int())
    .optional(),
  order: z.enum(["asc", "desc"]).default("desc"),
  limit: z
    .literal("")
    .transform(() => undefined)
    .or(
      z.coerce
        .number()
        .int()
        .positive()
        .min(1)
        .max(config.MAX_NUMBER_OF_MESSAGES_PER_QUERY)
    )
    .default(config.MAX_NUMBER_OF_MESSAGES_PER_QUERY),
});

app.get("/api/v1/messages", (req, res) => {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Transfer-Encoding", "chunked");

  const messagesQuerySchemaParseResult = messagesQuerySchema.safeParse(
    req.query
  );

  if ("error" in messagesQuerySchemaParseResult) {
    res.status(400);
    res.send(errorMessage);
    return;
  }

  const { timestampFrom, timestampTo, startsWith, limit, order } =
    messagesQuerySchemaParseResult.data;

  let queriedCache = cache;

  if (order === "asc") {
    queriedCache = queriedCache.reverse();
  }

  if (timestampFrom) {
    queriedCache = queriedCache.filter(
      ([timestamp]) => timestamp >= timestampFrom
    );
  }

  if (timestampTo) {
    queriedCache = queriedCache.filter(
      ([timestamp]) => timestamp <= timestampTo
    );
  }

  if (startsWith) {
    queriedCache = queriedCache.filter(([, messageText]) =>
      messageText.startsWith(startsWith)
    );
  }

  queriedCache = queriedCache.slice(0, limit);

  queriedCache.forEach((cacheEntry, cacheEntryIndex) => {
    res.write(formatCacheEntry(cacheEntry));

    if (cacheEntryIndex < queriedCache.length - 1) {
      res.write("\n");
    }
  });

  res.end();
});

const broadcastQuerySchema = z.object({
  messageText: z
    .string()
    .refine(checkMaxByteLength(config.MAX_MESSAGE_SIZE_IN_BYTES)),
});

app.post("/api/v1/broadcast", (req, res) => {
  const broadcastQuerySchemaParseResult = broadcastQuerySchema.safeParse(
    req.body
  );

  if ("error" in broadcastQuerySchemaParseResult) {
    res.status(400);
    res.send(errorMessage);
    return;
  }

  const { messageText } = broadcastQuerySchemaParseResult.data;

  const cacheEntry = [new Date().getTime(), messageText];

  const cacheEntrySizeInBytes = getCacheEntrySizeInBytes(cacheEntry);

  while (
    cacheSizeInBytes + cacheEntrySizeInBytes > finalMaxCacheSizeInBytes &&
    cache.length > 0
  ) {
    const removedCacheEntry = cache.pop();
    cacheSizeInBytes -= getCacheEntrySizeInBytes(removedCacheEntry);
  }

  cache.unshift(cacheEntry);

  cacheSizeInBytes += cacheEntrySizeInBytes;

  res.setHeader("Content-Type", "text/plain");
  res.status(201);
  res.send(formatCacheEntry(cacheEntry));
});

app.listen(config.PORT, () => {
  console.log(
    `MAX_NUMBER_OF_MESSAGES_PER_QUERY: ${config.MAX_NUMBER_OF_MESSAGES_PER_QUERY}`
  );
  console.log(`MAX_MESSAGE_SIZE_IN_BYTES: ${config.MAX_MESSAGE_SIZE_IN_BYTES}`);
  console.log(`MAX_CACHE_SIZE_IN_BYTES: ${config.MAX_CACHE_SIZE_IN_BYTES}`);

  console.log(`Max heap size in bytes: ${maxHeapSizeInBytes}`);
  console.log(`Final max cache size in bytes: ${finalMaxCacheSizeInBytes}`);

  console.log(
    `Broadcasting Tower v${version} listening on PORT: ${config.PORT}`
  );
});
