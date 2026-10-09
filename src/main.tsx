import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { CityDrive } from "./game/CityDrive";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CityDrive />
  </StrictMode>,
);
