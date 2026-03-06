// Content script injected into zhipin.com pages.
// MVP: parse basic job and candidate info and provide simple UI to mark candidates.

function getJobInfoFromPage() {
  // These selectors are guesses and may need adjustment based on real DOM.
  const jobTitleEl = document.querySelector(".job-title, .job-name");
  const companyEl = document.querySelector(".company-info .name, .job-company");
  const jdEl = document.querySelector(".job-sec-text, .job-detail, .job-intro");

  const jobTitle = jobTitleEl ? jobTitleEl.textContent.trim() : "";
  const company = companyEl ? companyEl.textContent.trim() : "";
  const jdText = jdEl ? jdEl.textContent.trim() : "";

  const jobIdMatch = window.location.href.match(/job\/(\d+)/);
  const jobId = jobIdMatch ? jobIdMatch[1] : window.location.href;

  return {
    jobId,
    jobTitle,
    jobUrl: window.location.href,
    company,
    jdText
  };
}

function buildCandidateId(cardEl) {
  const dataId = cardEl.getAttribute("data-uid") || cardEl.getAttribute("data-id");
  if (dataId) return dataId;
  return `${window.location.href}#${Array.from(document.querySelectorAll(".candidate-card, .resume-item")).indexOf(cardEl)}`;
}

function getCandidateInfoFromCard(cardEl, jobId) {
  const nameEl = cardEl.querySelector(".name, .user-name");
  const titleEl = cardEl.querySelector(".job, .position");
  const yearsEl = cardEl.querySelector(".work-exp, .exp");
  const salaryEl = cardEl.querySelector(".salary");
  const cityEl = cardEl.querySelector(".city, .area");

  return {
    candidateId: buildCandidateId(cardEl),
    name: nameEl ? nameEl.textContent.trim() : "",
    currentTitle: titleEl ? titleEl.textContent.trim() : "",
    yearsExp: yearsEl ? yearsEl.textContent.trim() : "",
    expectedSalary: salaryEl ? salaryEl.textContent.trim() : "",
    city: cityEl ? cityEl.textContent.trim() : "",
    jobIds: jobId ? [jobId] : [],
    status: "pending",
    tags: [],
    notes: ""
  };
}

function createToolbar(candidate) {
  const container = document.createElement("div");
  container.style.display = "flex";
  container.style.gap = "4px";
  container.style.marginTop = "4px";

  const btnQualified = document.createElement("button");
  btnQualified.textContent = "标记合格";
  btnQualified.style.fontSize = "12px";

  const btnUnqualified = document.createElement("button");
  btnUnqualified.textContent = "标记不合格";
  btnUnqualified.style.fontSize = "12px";

  const btnPending = document.createElement("button");
  btnPending.textContent = "待定";
  btnPending.style.fontSize = "12px";

  const statusLabel = document.createElement("span");
  statusLabel.textContent = "状态: 待评估";
  statusLabel.style.fontSize = "12px";
  statusLabel.style.marginLeft = "4px";

  function updateStatusLabel(status) {
    if (status === "qualified") statusLabel.textContent = "状态: 合格";
    else if (status === "unqualified") statusLabel.textContent = "状态: 不合格";
    else statusLabel.textContent = "状态: 待定";
  }

  btnQualified.addEventListener("click", () => {
    chrome.runtime.sendMessage(
      { type: "UPDATE_CANDIDATE_STATUS", candidateId: candidate.candidateId, status: "qualified" },
      (res) => {
        if (res && res.ok) updateStatusLabel("qualified");
      }
    );
  });

  btnUnqualified.addEventListener("click", () => {
    chrome.runtime.sendMessage(
      { type: "UPDATE_CANDIDATE_STATUS", candidateId: candidate.candidateId, status: "unqualified" },
      (res) => {
        if (res && res.ok) updateStatusLabel("unqualified");
      }
    );
  });

  btnPending.addEventListener("click", () => {
    chrome.runtime.sendMessage(
      { type: "UPDATE_CANDIDATE_STATUS", candidateId: candidate.candidateId, status: "pending" },
      (res) => {
        if (res && res.ok) updateStatusLabel("pending");
      }
    );
  });

  container.appendChild(btnQualified);
  container.appendChild(btnUnqualified);
  container.appendChild(btnPending);
  container.appendChild(statusLabel);

  return container;
}

function enhanceCandidateCards() {
  const jobInfo = getJobInfoFromPage();

  // Save job info once per page
  if (jobInfo.jobTitle || jobInfo.jdText) {
    chrome.runtime.sendMessage({ type: "SAVE_JOB", job: jobInfo }, () => {});
  }

  const cards = document.querySelectorAll(".candidate-card, .resume-item");
  cards.forEach((card) => {
    if (card.dataset._hrHelperEnhanced) return;
    card.dataset._hrHelperEnhanced = "1";

    const candidate = getCandidateInfoFromCard(card, jobInfo.jobId);
    chrome.runtime.sendMessage({ type: "UPDATE_CANDIDATE", candidate }, () => {});

    const toolbar = createToolbar(candidate);
    card.appendChild(toolbar);
  });
}

// Run once on load
enhanceCandidateCards();

// Observe DOM changes (for lazy-loaded candidates)
const observer = new MutationObserver(() => {
  enhanceCandidateCards();
});

observer.observe(document.body, { childList: true, subtree: true });

