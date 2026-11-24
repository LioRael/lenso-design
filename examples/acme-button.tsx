import type { ComponentProps } from "react";

export function AcmeButton({ children, className, ...props }: ComponentProps<"button">) {
  return (
    <button
      {...props}
      className={["acme-button", className].filter(Boolean).join(" ")}
      style={{
        background: "var(--acme-brand)",
        color: "var(--acme-on-brand)",
        borderRadius: "var(--acme-radius)",
        ...props.style,
      }}
    >
      {children}
    </button>
  );
}
