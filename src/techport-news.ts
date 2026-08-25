import { request } from "./transport";
import type { NewsItem } from "./types";

const TECHPORT_API = "https://techport.nasa.gov/api";
const TECHPORT_PROJECTS_URL = "https://techport.nasa.gov/projects";

export interface TechPortProjectIndexItem {
  projectId: number;
  lastUpdated: string;
}

export interface TechPortProject {
  projectId: number;
  title?: string;
  acronym?: string;
  status?: string;
  lastUpdated?: string;
  description?: string;
  benefits?: string;
  trlBegin?: number;
  trlEnd?: number;
  program?: { acronym?: string; title?: string };
  leadOrganization?: { acronym?: string; organizationName?: string };
}

let indexPromise: Promise<TechPortProjectIndexItem[]> | undefined;
const detailPromises = new Map<number, Promise<TechPortProject>>();

function plainText(value?: string): string {
  return (value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function excerpt(value: string, maximum = 360): string {
  if (value.length <= maximum) return value;
  const shortened = value.slice(0, maximum - 1);
  const boundary = shortened.lastIndexOf(" ");
  return `${shortened.slice(0, boundary > maximum * 0.65 ? boundary : shortened.length).trim()}…`;
}

export function parseTechPortDate(value: string): string | null {
  const input = value.trim();
  let year: number;
  let month: number;
  let day: number;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(input);
  if (match) {
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  } else {
    match = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(input);
    if (!match) return null;
    month = Number(match[1]);
    day = Number(match[2]);
    year = Number(match[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

export function selectTechPortUpdates(
  projects: TechPortProjectIndexItem[],
  targetDate: string,
  limit = 6,
  lookbackDays = 14,
): TechPortProjectIndexItem[] {
  const target = Date.parse(`${targetDate}T00:00:00Z`);
  if (!Number.isFinite(target)) return [];
  const earliest = target - lookbackDays * 86_400_000;
  return projects
    .map((project) => ({ project, date: parseTechPortDate(project.lastUpdated) }))
    .filter((entry): entry is { project: TechPortProjectIndexItem; date: string } => Boolean(entry.date))
    .filter((entry) => {
      const timestamp = Date.parse(`${entry.date}T00:00:00Z`);
      return timestamp <= target && timestamp >= earliest;
    })
    .sort((left, right) => right.date.localeCompare(left.date) || right.project.projectId - left.project.projectId)
    .slice(0, Math.max(0, limit))
    .map((entry) => entry.project);
}

export function techPortProjectToNewsItem(project: TechPortProject): NewsItem {
  const published = parseTechPortDate(project.lastUpdated || "") || "";
  const tags = [
    project.status,
    project.program?.acronym || project.program?.title,
    project.leadOrganization?.acronym || project.leadOrganization?.organizationName,
    project.trlBegin != null || project.trlEnd != null
      ? `TRL ${project.trlBegin ?? "?"}→${project.trlEnd ?? "?"}`
      : undefined,
  ].filter((tag): tag is string => Boolean(tag));
  const description = plainText(project.description) || plainText(project.benefits);
  return {
    id: `techport-${project.projectId}`,
    kind: "techport",
    title: plainText(project.title) || project.acronym || `NASA TechPort 项目 ${project.projectId}`,
    summary: excerpt(description),
    image: "",
    source: "NASA TechPort",
    published,
    tags: [...new Set(tags)],
    page_url: `${TECHPORT_PROJECTS_URL}/${project.projectId}`,
    original_url: "",
  };
}

async function requestJson<T>(url: string): Promise<T> {
  const response = await request({ url, method: "GET", headers: {}, timeoutSeconds: 30 });
  if (response.status < 200 || response.status >= 300) throw new Error(`NASA TechPort HTTP ${response.status}`);
  return response.body as T;
}

async function loadIndex(): Promise<TechPortProjectIndexItem[]> {
  if (!indexPromise) {
    indexPromise = requestJson<{ projects?: TechPortProjectIndexItem[] }>(`${TECHPORT_API}/projects`)
      .then((payload) => payload.projects || [])
      .catch((error) => {
        indexPromise = undefined;
        throw error;
      });
  }
  return indexPromise;
}

async function loadProject(projectId: number): Promise<TechPortProject> {
  let pending = detailPromises.get(projectId);
  if (!pending) {
    pending = requestJson<{ project?: TechPortProject }>(`${TECHPORT_API}/projects/${projectId}`)
      .then((payload) => {
        if (!payload.project) throw new Error(`TechPort 项目 ${projectId} 缺少详情`);
        return payload.project;
      })
      .catch((error) => {
        detailPromises.delete(projectId);
        throw error;
      });
    detailPromises.set(projectId, pending);
  }
  return pending;
}

export async function loadTechPortNews(targetDate: string): Promise<NewsItem[]> {
  const selected = selectTechPortUpdates(await loadIndex(), targetDate);
  const details = await Promise.allSettled(selected.map((item) => loadProject(item.projectId)));
  return details
    .filter((result): result is PromiseFulfilledResult<TechPortProject> => result.status === "fulfilled")
    .map((result) => techPortProjectToNewsItem(result.value));
}
