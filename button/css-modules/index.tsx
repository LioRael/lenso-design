import type { JSX } from "solid-js";
import { root } from "./recipe";

export function Button(props: { children: JSX.Element; disabled?: boolean; onClick?: () => void }) {
  return <button type="button" class={root} disabled={props.disabled} onClick={props.onClick}>{props.children}</button>;
}
