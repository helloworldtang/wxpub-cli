/**
 * wxpub history 子命令组——发布历史（列表/详情/统计/删除/封面操作），
 * JWT 管理台通道；普通用户只见自己账号。
 */

import type { Command } from "commander";
import { Command as CommanderCommand } from "commander";

import type { HistoryItem } from "../admin.js";
import { createAdminClient } from "../admin.js";

function printHistoryLine(item: HistoryItem): void {
  const cover =
    item.cover_strategy === "none"
      ? "无封面"
      : (item.ai_cover_status ?? item.cover_swap_status ?? "-");
  console.log(
    `  id:${item.id}  [${item.status}] ${item.article_title}  ${item.created_at}  封面:${cover}${item.cover_manual ? "（手工）" : ""}`,
  );
}

export function registerHistoryCommand(program: Command): Command {
  const history = new CommanderCommand("history").description(
    "发布历史（列表/详情/统计/删除/封面重生成）——需 wxpub login 登录",
  );

  history
    .command("list")
    .description("发布历史列表")
    .option("--page <n>", "页码（默认 1）", (value) => Number.parseInt(value, 10))
    .option("--size <n>", "每页条数（默认 20，最大 100）", (value) => Number.parseInt(value, 10))
    .option("--account <id>", "按账号 id 过滤", (value) => Number.parseInt(value, 10))
    .option("--status <status>", "按状态过滤")
    .action(async (options) => {
      const client = createAdminClient();
      const page = await client.listHistory({
        page: options.page,
        pageSize: options.size,
        accountId: options.account,
        status: options.status,
      });
      if (program.opts().json) {
        console.log(JSON.stringify(page));
        return;
      }
      console.log(`共 ${page.total} 条（第 ${page.page} 页，每页 ${page.page_size}）：`);
      for (const item of page.items) {
        printHistoryLine(item);
      }
    });

  history
    .command("get")
    .description("历史记录详情")
    .argument("<id>", "记录 id", (value) => Number.parseInt(value, 10))
    .action(async (id: number) => {
      const client = createAdminClient();
      const item = await client.getHistory(id);
      if (program.opts().json) {
        console.log(JSON.stringify(item));
        return;
      }
      printHistoryLine(item);
      if (item.media_id) {
        console.log(`  media_id：${item.media_id}`);
      }
      if (item.article_url) {
        console.log(`  链接：${item.article_url}`);
      }
      if (item.error_message) {
        console.log(`  错误：${item.error_message}`);
      }
      if (item.theme_name) {
        console.log(`  主题：${item.theme_name}`);
      }
    });

  history
    .command("stats")
    .description("发布统计")
    .option("-a, --account <id>", "按账号 id 过滤", (value) => Number.parseInt(value, 10))
    .action(async (options) => {
      const client = createAdminClient();
      const stats = await client.historyStats(options.account);
      if (program.opts().json) {
        console.log(JSON.stringify(stats));
        return;
      }
      console.log(
        `共 ${stats.total_publishes} 篇（成功 ${stats.success_count} / 失败 ${stats.failed_count}，成功率 ${stats.success_rate.toFixed(1)}%）`,
      );
      console.log(
        `  今日 ${stats.today_count}  本周 ${stats.week_count}  本月 ${stats.month_count}`,
      );
    });

  history
    .command("rm")
    .description("删除历史记录（不确认，agent 自律）")
    .argument("<id>", "记录 id", (value) => Number.parseInt(value, 10))
    .action(async (id: number) => {
      const client = createAdminClient();
      await client.deleteHistory(id);
      if (program.opts().json) {
        console.log(JSON.stringify({ deleted: true, id }));
        return;
      }
      console.log(`已删除历史记录 id:${id}`);
    });

  history
    .command("cover")
    .description("封面操作：--regen 重新生成 AI 封面 / --manual 标记已手工更新")
    .argument("<id>", "记录 id", (value) => Number.parseInt(value, 10))
    .option("--regen", "重新生成 AI 封面（异步 job）", false)
    .option("--preset <id>", "封面模板 id（缺省用账号默认）", (value) => Number.parseInt(value, 10))
    .option("--manual", "标记「已手工更新封面」", false)
    .action(async (id: number, options) => {
      if (options.regen === options.manual) {
        throw new Error("cover 需要 --regen 或 --manual 二选一");
      }
      const client = createAdminClient();
      if (options.regen) {
        const job = await client.regenCover(id, { presetId: options.preset });
        if (program.opts().json) {
          console.log(JSON.stringify(job));
          return;
        }
        console.log(`已提交封面重生成 job:${job.job_id}——${job.message}`);
        console.log("异步任务，稍后 `wxpub history list` 看 cover_swap_status。");
        return;
      }
      const result = await client.manualCover(id);
      if (program.opts().json) {
        console.log(JSON.stringify({ id, ...result }));
        return;
      }
      console.log(result.message);
    });

  return history;
}
