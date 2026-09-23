import { createRouter } from "@tanstack/react-router";
import { AppErrorComponent, AppNotFound } from "@/lib/error-component";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  return createRouter({
    routeTree,
    defaultErrorComponent: AppErrorComponent,
    defaultNotFoundComponent: AppNotFound,
    // Without this, a cross-route navigation (e.g. guest scrolled down on `/`
    // clicking through to `/login`) keeps the prior route's scroll offset.
    scrollRestoration: true,
  });
}
