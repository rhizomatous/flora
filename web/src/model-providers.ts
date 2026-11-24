export const hostedProviders = [
  { id: "anthropic", name: "Anthropic" },
  { id: "openai", name: "OpenAI" },
  { id: "google", name: "Google" },
];
export function providerName(id: string) {
  return hostedProviders.find((provider) => provider.id === id)?.name ?? id;
}
