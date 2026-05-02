import { Router, type IRouter } from "express";
import { readFileSync } from "fs";
import { resolve } from "path";
import { parse } from "yaml";

const router: IRouter = Router();

const yamlPath = resolve(__dirname, "../../../lib/api-spec/openapi.yaml");

router.get("/openapi.json", (_req, res) => {
  try {
    const yaml = readFileSync(yamlPath, "utf-8");
    const spec = parse(yaml) as Record<string, unknown>;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.json(spec);
  } catch (err) {
    res.status(500).json({ error: "Failed to load OpenAPI spec", detail: String(err) });
  }
});

router.get("/openapi.yaml", (_req, res) => {
  try {
    const yaml = readFileSync(yamlPath, "utf-8");
    res.setHeader("Content-Type", "application/yaml");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.send(yaml);
  } catch (err) {
    res.status(500).json({ error: "Failed to load OpenAPI spec", detail: String(err) });
  }
});

export default router;
