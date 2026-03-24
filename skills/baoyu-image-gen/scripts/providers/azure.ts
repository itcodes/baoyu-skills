import path from "node:path";
import { readFile } from "node:fs/promises";
import type { CliArgs } from "../types";
import { getOpenAISize, parseAspectRatio, getMimeType, extractImageFromResponse } from "./openai";

type OpenAIImageResponse = { data: Array<{ url?: string; b64_json?: string }> };

export function getDefaultModel(): string {
  return process.env.AZURE_OPENAI_IMAGE_MODEL || "gpt-image-1.5";
}

function getBaseURL(): string {
  const url = process.env.AZURE_OPENAI_BASE_URL;
  if (!url) {
    throw new Error(
      "AZURE_OPENAI_BASE_URL is required. Set it to your Azure deployment endpoint, e.g.: https://your-resource.openai.azure.com/openai/deployments/your-deployment"
    );
  }
  return url.replace(/\/+$/, "");
}

function getApiKey(): string {
  const key = process.env.AZURE_OPENAI_API_KEY;
  if (!key) {
    throw new Error(
      "AZURE_OPENAI_API_KEY is required. Get it from Azure Portal → your OpenAI resource → Keys and Endpoint."
    );
  }
  return key;
}

function getApiVersion(): string {
  return process.env.AZURE_API_VERSION || "2024-02-01";
}

function buildURL(pathSuffix: string): string {
  return `${getBaseURL()}${pathSuffix}?api-version=${getApiVersion()}`;
}

function authHeaders(): Record<string, string> {
  return { "api-key": getApiKey() };
}

export async function generateImage(
  prompt: string,
  model: string,
  args: CliArgs
): Promise<Uint8Array> {
  const size = args.size || getOpenAISize(model, args.aspectRatio, args.quality);

  if (args.referenceImages.length > 0) {
    return generateWithAzureEdits(prompt, model, size, args.referenceImages, args.quality);
  }

  return generateWithAzureGenerations(prompt, model, size, args.quality);
}

async function generateWithAzureGenerations(
  prompt: string,
  model: string,
  size: string,
  quality: CliArgs["quality"]
): Promise<Uint8Array> {
  const body: Record<string, any> = { prompt, size, n: 1 };

  const res = await fetch(buildURL("/images/generations"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Azure OpenAI API error: ${err}`);
  }

  const result = (await res.json()) as OpenAIImageResponse;
  return extractImageFromResponse(result);
}

async function generateWithAzureEdits(
  prompt: string,
  model: string,
  size: string,
  referenceImages: string[],
  quality: CliArgs["quality"]
): Promise<Uint8Array> {
  const form = new FormData();
  form.append("prompt", prompt);
  form.append("size", size);

  for (const refPath of referenceImages) {
    const bytes = await readFile(refPath);
    const filename = path.basename(refPath);
    const mimeType = getMimeType(filename);
    const blob = new Blob([bytes], { type: mimeType });
    form.append("image[]", blob, filename);
  }

  const res = await fetch(buildURL("/images/edits"), {
    method: "POST",
    headers: {
      ...authHeaders(),
    },
    body: form,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Azure OpenAI edits API error: ${err}`);
  }

  const result = (await res.json()) as OpenAIImageResponse;
  return extractImageFromResponse(result);
}
