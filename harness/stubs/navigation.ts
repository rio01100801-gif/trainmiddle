export function usePathname(): string {
  return (globalThis as any).__PATH__ ?? "/";
}
export function useRouter() {
  return { push: () => {}, replace: () => {}, back: () => {} };
}
