import { Toggle } from "@ui-sdk/solid/toggle";
import { root } from "./recipe";

export function BoldToggle() {
  return <Toggle class={root} aria-label="Bold">B</Toggle>;
}
