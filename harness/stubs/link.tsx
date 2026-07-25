import * as React from "react";
export default function Link({ href, children, ...rest }: any) {
  return React.createElement("a", { href, ...rest }, children);
}
