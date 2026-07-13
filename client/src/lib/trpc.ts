import { createTRPCReact } from "@trpc/react-query";
import type { AnyRouter } from "@trpc/server";
// Stub router type for frontend-only build
type AppRouter = AnyRouter;
export const trpc = createTRPCReact<AppRouter>();
