declare module "virtual:flora-file-icons" {
  const manifest: {
    names: Record<string, string>;
    extensions: Record<string, string>;
    lightNames: Record<string, string>;
    lightExtensions: Record<string, string>;
    fallback: string;
  };
  export default manifest;
  export const icons: Record<string, string>;
}
