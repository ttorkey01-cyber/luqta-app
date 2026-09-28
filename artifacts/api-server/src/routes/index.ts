import { Router, type IRouter } from "express";
import healthRouter from "./health";
import providersRouter from "./providers";
import searchRouter from "./search";
import homeRouter from "./home";
import nazihImagesRouter from "./nazihImages";
import devicesRouter from "./devices";
import huntsRouter from "./hunts";

const router: IRouter = Router();

router.use(healthRouter);
router.use(providersRouter);
router.use(searchRouter);
router.use(homeRouter);
router.use(nazihImagesRouter);
router.use(devicesRouter);
router.use(huntsRouter);

export default router;
