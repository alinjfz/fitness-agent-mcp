import { Router, type IRouter } from "express";
import healthRouter from "./health";
import stateRouter from "./state";
import logCompletionRouter from "./logCompletion";
import normalizeRouter from "./normalize";
import mcpRouter from "./mcp";
import openapiRouter from "./openapi";

const router: IRouter = Router();

router.use(healthRouter);
router.use(stateRouter);
router.use(logCompletionRouter);
router.use(normalizeRouter);
router.use(mcpRouter);
router.use(openapiRouter);

export default router;
