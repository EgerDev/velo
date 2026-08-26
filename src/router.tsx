import { createRouter } from "@tanstack/react-router";
import { AppErrorComponent } from "@/lib/error-component";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  return createRouter({
    routeTree,
    defaultErrorComponent: AppErrorComponent,
    // Without this, a cross-route navigation (e.g. guest scrolled down on `/`
    // clicking through to `/login`) keeps the prior route's scroll offset.
    scrollRestoration: true,
  });
}
