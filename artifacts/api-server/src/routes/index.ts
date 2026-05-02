import { Router, type IRouter } from "express";
import healthRouter from "./health";
import stateRouter from "./state";
import logCompletionRouter from "./logCompletion";
import normalizeRouter from "./normalize";
import mcpRouter from "./mcp";
import openapiRouter from "./openapi";
import generatePlanRouter from "./generatePlan";
import scheduleEventsRouter from "./scheduleEvents";
import exportRouter from "./export";
import systemPromptRouter from "./systemPrompt";
import progressRouter from "./progress";
import progressHistoryRouter from "./progressHistory";
import ingestRouter from "./ingest";

const router: IRouter = Router();

router.use(healthRouter);
router.use(stateRouter);
router.use(logCompletionRouter);
router.use(normalizeRouter);
router.use(mcpRouter);
router.use(openapiRouter);
router.use(generatePlanRouter);
router.use(scheduleEventsRouter);
router.use(exportRouter);
router.use(systemPromptRouter);
router.use(progressRouter);
router.use(progressHistoryRouter);
router.use(ingestRouter);

export default router;
