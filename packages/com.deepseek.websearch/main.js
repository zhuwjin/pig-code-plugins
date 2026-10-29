import { View, div } from "gpui-kit";
import { h_flex, v_flex, Button } from "gpui-base";
import { InputGroupInput, InputState } from "gpui-component";
import {
  translate as t,
  next_tool_call,
  complete_tool_call,
  secret_status,
  set_secret,
  clear_secret,
  request_http,
  mono_font_family,
} from "pig-code";

const MAX_SEARCH_OUTPUT = 30 * 1024;

function utf8Length(text) {
  let length = 0;
  for (const character of text) {
    const point = character.codePointAt(0);
    length += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return length;
}

function formatHits(query, hits) {
  let output = `Search results for "${query}" (DeepSeek, ${hits.length} results)\n\n`;
  for (let index = 0; index < hits.length; index += 1) {
    const hit = hits[index];
    const summary = hit.summary || hit.snippet || "";
    const entry = `${index + 1}. ${hit.title}\n   ${hit.url}\n   ${summary}\n\n`;
    if (utf8Length(output) + utf8Length(entry) > MAX_SEARCH_OUTPUT) {
      output += `[... ${hits.length - index} more result(s) omitted over the output budget]`;
      break;
    }
    output += entry;
  }
  return output;
}

async function executeTool(call) {
  if (call.tool !== "DeepSeekSearch") {
    throw new Error(`Unsupported tool: ${call.tool}`);
  }
  const args = call.args || {};
  const query = typeof args.query === "string" ? args.query.trim() : "";
  if (!query) {
    throw new Error("DeepSeekSearch is missing the query parameter");
  }
  if ([...query].length > 128) {
    throw new Error("DeepSeekSearch queries are limited to 128 Unicode characters");
  }
  const requested = Number.isInteger(args.max_results) && args.max_results >= 0
    ? args.max_results
    : 10;
  const count = Math.max(1, Math.min(10, requested));
  if (!secret_status(["deepseek"]).deepseek) {
    throw new Error("DeepSeek Search is not configured: save an API key in Settings first.");
  }
  const response = await request_http({
    origin: "deepseek",
    method: "POST",
    headers: { Accept: "application/json" },
    body: { query, count, need_content: false },
    credential: { credential: "deepseek", header: "Authorization", prefix: "Bearer " },
  });
  if (!response.ok) {
    throw new Error(response.error?.detail || "The DeepSeek search request failed");
  }
  const result = response.value;
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`DeepSeek returned ${result.status}`);
  }
  let body;
  try {
    body = JSON.parse(result.body);
  } catch (error) {
    throw new Error(`Failed to parse the DeepSeek response: ${error.message}`);
  }
  const hits = (Array.isArray(body.results) ? body.results : []).map((item) => ({
    title: typeof item.title === "string" ? item.title : "",
    url: typeof item.url === "string" ? item.url : "",
    summary: typeof item.summary === "string" && item.summary
      ? item.summary
      : typeof item.snippet === "string" ? item.snippet : "",
  }));
  return hits.length === 0
    ? `No results for "${query}" (DeepSeek)`
    : formatHits(query, hits);
}

export default class DeepSeekPage extends View {
  init(_props, cx) {
    this.data = null;
    this.error = null;
    this.deepseek = InputState.new();
    this.refresh(cx);
    this.toolWorker = cx.spawn(async (cx) => {
      while (true) {
        const call = await next_tool_call();
        if (call === null) {
          break;
        }
        let result;
        try {
          result = { Ok: await executeTool(call) };
        } catch (error) {
          result = {
            Err: {
              kind: "plugin_transport",
              detail: error instanceof Error ? error.message : String(error),
            },
          };
        }
        complete_tool_call({
          request_id: call.request_id,
          session_id: call.session_id,
          result,
        });
      }
      cx.notify();
    });
  }

  refresh(cx) {
    this.error = null;
    cx.spawn(async (cx) => {
      try {
        this.data = secret_status(["deepseek"]);
      } catch (error) {
        this.error = String(error);
      }
      cx.notify();
    });
  }

  saveSecret(cx) {
    const secret = this.deepseek.value();
    if (!secret.trim()) {
      this.error = t("settings.websearch.empty_key");
      cx.notify();
      return;
    }
    cx.spawn(async (cx) => {
      try {
        const result = await set_secret("deepseek", secret);
        if (!result.ok) {
          throw new Error(result.error?.detail || "Failed to save the API key");
        }
        this.deepseek.set_value("");
        this.refresh(cx);
      } catch (error) {
        this.error = String(error);
        cx.notify();
      }
    });
  }

  clearSecret(cx) {
    cx.spawn(async (cx) => {
      try {
        const result = await clear_secret("deepseek");
        if (!result.ok) {
          throw new Error(result.error?.detail || "Failed to clear the API key");
        }
        this.refresh(cx);
      } catch (error) {
        this.error = String(error);
        cx.notify();
      }
    });
  }

  render(cx) {
    const colors = cx.theme().colors;
    const page = v_flex().w_full().gap(16).text_color(colors.foreground);
    if (this.error) {
      return page.child(div().text_sm().text_color(colors.destructive).child(this.error));
    }
    if (!this.data) {
      return page.child(div().text_sm().text_color(colors.muted_foreground).child("…"));
    }
    const configured = this.data.deepseek;
    return page
      .child(
        h_flex().w_full().justify_end().child(
          Button.new("deepseek-refresh")
            .h(28)
            .px(10)
            .items_center()
            .justify_center()
            .rounded(6)
            .border(1)
            .border_color(colors.border)
            .text_sm()
            .text_color(colors.foreground)
            .on_click((_event, cx) => this.refresh(cx))
            .child(t("settings.common.refresh")),
        ),
      )
      .child(
        v_flex()
          .w_full()
          .gap(8)
          .p(12)
          .rounded(8)
          .border(1)
          .border_color(colors.border)
          .child(
            h_flex()
              .w_full()
              .items_center()
              .gap(8)
              .child(div().size(8).rounded_full().bg(configured ? colors.primary : colors.muted_foreground))
              .child(div().text_sm().font_semibold().child("DeepSeek"))
              .child(div().flex_1())
              .child(
                div()
                  .text_xs()
                  .text_color(configured ? colors.primary : colors.muted_foreground)
                  .child(t(configured ? "settings.websearch.configured" : "settings.websearch.not_configured")),
              ),
          )
          .child(InputGroupInput.new(this.deepseek).masked(true).w_full())
          .child(
            h_flex()
              .w_full()
              .items_center()
              .gap(8)
              .child(div().text_xs().font_family(mono_font_family()).text_color(colors.muted_foreground).child("deepseek"))
              .child(div().flex_1())
              .child(
                Button.new("clear-deepseek")
                  .h(28)
                  .px(10)
                  .items_center()
                  .justify_center()
                  .rounded(6)
                  .border(1)
                  .border_color(colors.border)
                  .text_sm()
                  .text_color(colors.foreground)
                  .disabled(!configured)
                  .on_click((_event, cx) => this.clearSecret(cx))
                  .child(t("settings.websearch.clear_key")),
              )
              .child(
                Button.new("save-deepseek")
                  .h(28)
                  .px(10)
                  .items_center()
                  .justify_center()
                  .rounded(6)
                  .border(1)
                  .border_color(colors.border)
                  .text_sm()
                  .text_color(colors.foreground)
                  .on_click((_event, cx) => this.saveSecret(cx))
                  .child(t("settings.websearch.save_key")),
              ),
          ),
      )
      .child(
        div()
          .text_xs()
          .text_color(colors.muted_foreground)
          .child(t("settings.websearch.keyring_hint")),
      );
  }
}
