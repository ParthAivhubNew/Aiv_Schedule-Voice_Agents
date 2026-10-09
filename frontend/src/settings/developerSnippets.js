import { API_BASE } from "./developerCatalog";

export const SNIPPET_LANGS = ["curl", "node", "python", "php", "go", "java"];

// A ready-to-paste request in the chosen language, for any method (GET, POST, PATCH, DELETE).
export function buildSnippet(lang, method, path, apiKey, bodyText) {
  const token = apiKey || "sk_test_YOUR_KEY";
  const url = `${API_BASE}${path}`;
  const hasBody = method !== "GET" && method !== "DELETE" && Boolean((bodyText || "").trim());
  const body = hasBody ? bodyText.trim() : "";

  if (lang === "curl") {
    const lines = [`curl -X ${method} "${url}"`, `  -H "Authorization: Bearer ${token}"`];
    if (hasBody) {
      lines.push('  -H "Content-Type: application/json"');
      lines.push(`  -d '${body.replace(/'/g, "'\\''")}'`);
    }
    return lines.join(" \\\n");
  }

  if (lang === "node") {
    const headers = [`    "Authorization": "Bearer ${token}"`];
    if (hasBody) headers.push('    "Content-Type": "application/json"');
    const opts = [`  method: "${method}"`, `  headers: {\n${headers.join(",\n")}\n  }`];
    if (hasBody) opts.push(`  body: JSON.stringify(${body})`);
    return `const response = await fetch("${url}", {\n${opts.join(",\n")}\n});\nconst data = await response.json();\nconsole.log(data);`;
  }

  if (lang === "python") {
    const head = `import requests\n\nheaders = {"Authorization": "Bearer ${token}"}\n`;
    if (hasBody) {
      return `${head}payload = ${body}\n\nresponse = requests.request("${method}", "${url}", headers=headers, json=payload)\nprint(response.json())`;
    }
    return `${head}\nresponse = requests.request("${method}", "${url}", headers=headers)\nprint(response.json())`;
  }

  if (lang === "php") {
    const opts = ["    CURLOPT_RETURNTRANSFER => true", `    CURLOPT_CUSTOMREQUEST => "${method}"`];
    const headers = [`"Authorization: Bearer ${token}"`];
    if (hasBody) {
      headers.push('"Content-Type: application/json"');
      opts.push(`    CURLOPT_POSTFIELDS => '${body.replace(/'/g, "\\'")}'`);
    }
    opts.push(`    CURLOPT_HTTPHEADER => [${headers.join(", ")}]`);
    return `$ch = curl_init("${url}");\ncurl_setopt_array($ch, [\n${opts.join(",\n")}\n]);\n$response = curl_exec($ch);\ncurl_close($ch);\necho $response;`;
  }

  if (lang === "go") {
    const reader = hasBody ? "bytes.NewBufferString(`" + body + "`)" : "nil";
    const lines = [`req, _ := http.NewRequest("${method}", "${url}", ${reader})`, `req.Header.Set("Authorization", "Bearer ${token}")`];
    if (hasBody) lines.push('req.Header.Set("Content-Type", "application/json")');
    lines.push("resp, _ := http.DefaultClient.Do(req)", "out, _ := io.ReadAll(resp.Body)", "fmt.Println(string(out))");
    return lines.join("\n");
  }

  if (lang === "java") {
    const publisher = hasBody ? 'HttpRequest.BodyPublishers.ofString(json)' : "HttpRequest.BodyPublishers.noBody()";
    const json = hasBody ? `String json = """\n${body}\n""";\n` : "";
    const type = hasBody ? '\n    .header("Content-Type", "application/json")' : "";
    return `${json}HttpRequest request = HttpRequest.newBuilder()\n    .uri(URI.create("${url}"))\n    .header("Authorization", "Bearer ${token}")${type}\n    .method("${method}", ${publisher})\n    .build();\nHttpResponse<String> response = HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofString());\nSystem.out.println(response.body());`;
  }

  return "";
}

export function snippetsFor(method, path, apiKey, bodyText) {
  return Object.fromEntries(SNIPPET_LANGS.map((l) => [l, buildSnippet(l, method, path, apiKey, bodyText)]));
}
