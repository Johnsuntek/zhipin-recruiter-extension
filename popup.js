function statusLabel(status) {
  if (status === "qualified") return "合格";
  if (status === "unqualified") return "不合格";
  if (status === "pending") return "待定";
  return status || "未知";
}

function statusBadgeClass(status) {
  if (status === "qualified") return "badge badge-qualified";
  if (status === "unqualified") return "badge badge-unqualified";
  return "badge badge-pending";
}

function renderCandidates(data, filterStatus) {
  const listEl = document.getElementById("candidateList");
  listEl.innerHTML = "";
  const candidates = data.candidates || {};
  const jobs = data.jobs || {};

  const items = Object.values(candidates)
    .filter((c) => {
      if (filterStatus === "all") return true;
      return c.status === filterStatus;
    })
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));

  if (!items.length) {
    listEl.textContent = "暂无候选人数据。请在 zhipin.com 上浏览候选人列表并进行打标。";
    return;
  }

  items.forEach((c) => {
    const itemEl = document.createElement("div");
    itemEl.className = "candidate-item";

    const header = document.createElement("div");
    header.className = "candidate-header";
    const left = document.createElement("div");
    left.textContent = c.name || "未命名候选人";
    const right = document.createElement("div");
    const badge = document.createElement("span");
    badge.className = statusBadgeClass(c.status);
    badge.textContent = statusLabel(c.status);
    right.appendChild(badge);
    header.appendChild(left);
    header.appendChild(right);

    const meta = document.createElement("div");
    meta.className = "candidate-meta";
    const jobTitles =
      (c.jobIds || [])
        .map((id) => (jobs[id] ? jobs[id].jobTitle : ""))
        .filter(Boolean)
        .join(" / ") || "关联职位：-";
    meta.textContent = [
      c.currentTitle || "",
      c.yearsExp || "",
      c.expectedSalary || "",
      c.city || "",
      jobTitles
    ]
      .filter(Boolean)
      .join(" ｜ ");

    itemEl.appendChild(header);
    itemEl.appendChild(meta);
    listEl.appendChild(itemEl);
  });
}

function loadData() {
  chrome.runtime.sendMessage({ type: "GET_ALL_DATA" }, (res) => {
    if (!res || !res.ok) return;
    const select = document.getElementById("statusFilter");
    const filterStatus = select.value;
    renderCandidates(res.data, filterStatus);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const select = document.getElementById("statusFilter");
  select.addEventListener("change", loadData);
  loadData();
});

