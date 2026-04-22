export interface NpmDownloadPoint {
  packageName: string;
  downloads: number;
  start: string;
  end: string;
}

export async function fetchNpmDownloads(packages: string[], start: string, end: string) {
  const results: NpmDownloadPoint[] = [];

  for (const packageName of packages) {
    const response = await fetch(
      `https://api.npmjs.org/downloads/point/${start}:${end}/${encodeURIComponent(packageName)}`,
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch npm downloads for ${packageName}: ${response.status}`);
    }

    const data = (await response.json()) as {
      downloads: number;
      start: string;
      end: string;
      package: string;
    };

    results.push({
      packageName,
      downloads: data.downloads,
      start: data.start,
      end: data.end,
    });
  }

  return results;
}
