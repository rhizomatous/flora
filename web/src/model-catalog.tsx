import { useState } from "react";

import {
  Badge,
  Button,
  Card,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Heading,
  Input,
  LoadingStatus,
  EllipsisIcon,
  Section,
  SectionHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
} from "@flora/florets";

import { ModelIcon } from "./model-icon";
import { matchModel, type ModelOption } from "./model-options";
import { providerName } from "./model-providers";
import type { Settings } from "./settings-schemas";

const amount = (value: number) =>
  new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
const price = (value: number | null) =>
  value === null ? "–" : `$${value.toLocaleString("en", { maximumFractionDigits: 3 })}`;

export function ModelCatalog({
  models,
  settings,
  loading,
  busy,
  onDefault,
}: {
  models: ModelOption[];
  settings: Settings;
  loading: boolean;
  busy: boolean;
  onDefault: (model: ModelOption) => void;
}) {
  const [query, setQuery] = useState("");
  const visible = models.filter((model) =>
    matchModel(model.name, query, [model.id, model.provider, providerName(model.provider)]),
  );
  return (
    <Section aria-labelledby="available-models-heading">
      <SectionHeader inset className="gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Heading level={2} id="available-models-heading">
            Available models
          </Heading>
          <Badge variant="secondary">{models.length}</Badge>
        </div>
        <Input
          aria-label="Search available models"
          placeholder="Search models"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          className="w-full sm:w-56"
        />
      </SectionHeader>
      <Card variant="flush">
        {loading && models.length === 0 ? (
          <div className="p-6">
            <LoadingStatus>Loading models…</LoadingStatus>
          </div>
        ) : (
          <Table className="table-fixed">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[70%] pl-4 sm:w-[38%]">Model</TableHead>
                <TableHead className="hidden text-right md:table-cell">Context</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Input / 1M</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Output / 1M</TableHead>
                <TableHead className="hidden lg:table-cell">Reasoning</TableHead>
                <TableHead className="w-20 pr-4">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((model) => {
                const isDefault =
                  model.provider === settings.provider && model.id === settings.model;
                return (
                  <TableRow key={`${model.provider}/${model.id}`}>
                    <TableCell className="max-w-0 py-3.5 pl-4">
                      <div className="flex min-w-0 items-center gap-3">
                        <ModelIcon provider={model.provider} model={model.id} />
                        <div className="min-w-0">
                          <div className="truncate font-medium" title={model.name}>
                            {model.name}
                          </div>
                          <Text size="xs" tone="muted" className="mt-1">
                            {providerName(model.provider)}
                            {model.contextLimit > 0 && (
                              <span className="md:hidden">
                                {" "}
                                · {amount(model.contextLimit)} context
                              </span>
                            )}
                          </Text>
                          {(model.inputPrice !== null || model.outputPrice !== null) && (
                            <Text
                              size="xs"
                              tone="muted"
                              className="mt-1 whitespace-normal sm:hidden"
                            >
                              Input {price(model.inputPrice)} · Output {price(model.outputPrice)} /
                              1M
                            </Text>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden text-right text-muted-foreground tabular-nums md:table-cell">
                      {model.contextLimit > 0 ? amount(model.contextLimit) : "–"}
                    </TableCell>
                    <TableCell className="hidden text-right text-muted-foreground tabular-nums sm:table-cell">
                      {price(model.inputPrice)}
                    </TableCell>
                    <TableCell className="hidden text-right text-muted-foreground tabular-nums sm:table-cell">
                      {price(model.outputPrice)}
                    </TableCell>
                    <TableCell
                      className="hidden max-w-32 truncate text-muted-foreground lg:table-cell"
                      title={model.variants.join(", ")}
                    >
                      {model.variants.length > 0
                        ? `${model.variants[0]}–${model.variants.at(-1)}`
                        : "–"}
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      {isDefault ? (
                        <Badge variant="secondary">Default</Badge>
                      ) : (
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`${model.name} actions`}
                                disabled={busy}
                              >
                                <EllipsisIcon />
                              </Button>
                            }
                          />
                          <DropdownMenuContent
                            align="end"
                            className="w-44"
                            finalFocus={() =>
                              document.querySelector<HTMLButtonElement>("#default-model")
                            }
                          >
                            <DropdownMenuItem
                              value="default"
                              onClick={() => {
                                onDefault(model);
                              }}
                            >
                              Use as default
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {visible.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    {query ? "No matching models" : "No models available"}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </Card>
    </Section>
  );
}
