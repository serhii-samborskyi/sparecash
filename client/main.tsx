import { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { BrandMark } from "./components/brand-mark";
const Admin = lazy(() => import("./Admin").then((m) => ({ default: m.Admin })));
const Public = lazy(() =>
  import("./Public").then((m) => ({ default: m.Public })),
);
createRoot(document.getElementById("root")!).render(
  <Suspense
    fallback={
      <div className="startup">
        <BrandMark />
      </div>
    }
  >
    {location.pathname.startsWith("/admin") ? <Admin /> : <Public />}
  </Suspense>,
);
