// Background script: manages in-memory cache and chrome.storage for jobs and candidates.

const STORAGE_KEYS = {
  JOBS: "jobs",
  CANDIDATES: "candidates"
};

/**
 * job: {
 *   jobId: string,
 *   jobTitle: string,
 *   jobUrl: string,
 *   company: string,
 *   jdText: string,
 *   lastScannedAt: string
 * }
 *
 * candidate: {
 *   candidateId: string,
 *   name: string,
 *   currentTitle: string,
 *   yearsExp: string,
 *   expectedSalary: string,
 *   city: string,
 *   jobIds: string[],
 *   status: 'qualified' | 'unqualified' | 'pending' | 'contacted' | 'scheduled',
 *   tags: string[],
 *   notes: string,
 *   interviewDateTime?: string,
 *   interviewChannel?: string,
 *   responsibleHRBP?: string,
 *   updatedAt: string
 * }
 */

async function getAllData() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEYS.JOBS, STORAGE_KEYS.CANDIDATES], (res) => {
      resolve({
        jobs: res[STORAGE_KEYS.JOBS] || {},
        candidates: res[STORAGE_KEYS.CANDIDATES] || {}
      });
    });
  });
}

async function saveJobs(jobs) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEYS.JOBS]: jobs }, () => resolve());
  });
}

async function saveCandidates(candidates) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEYS.CANDIDATES]: candidates }, () => resolve());
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message.type === "SAVE_JOB") {
      const { job } = message;
      const { jobs } = await getAllData();
      const now = new Date().toISOString();
      const existing = jobs[job.jobId] || {};
      jobs[job.jobId] = {
        ...existing,
        ...job,
        lastScannedAt: now
      };
      await saveJobs(jobs);
      sendResponse({ ok: true });
    } else if (message.type === "UPDATE_CANDIDATE") {
      const { candidate } = message;
      const { candidates } = await getAllData();
      const now = new Date().toISOString();
      const existing = candidates[candidate.candidateId] || {};
      candidates[candidate.candidateId] = {
        status: "pending",
        tags: [],
        notes: "",
        jobIds: [],
        ...existing,
        ...candidate,
        updatedAt: now
      };
      await saveCandidates(candidates);
      sendResponse({ ok: true });
    } else if (message.type === "GET_ALL_DATA") {
      const data = await getAllData();
      sendResponse({ ok: true, data });
    } else if (message.type === "UPDATE_CANDIDATE_STATUS") {
      const { candidateId, status, tags, notes } = message;
      const { candidates } = await getAllData();
      if (!candidates[candidateId]) {
        sendResponse({ ok: false, error: "Candidate not found" });
        return;
      }
      const now = new Date().toISOString();
      candidates[candidateId] = {
        ...candidates[candidateId],
        status: status || candidates[candidateId].status,
        tags: tags || candidates[candidateId].tags,
        notes: typeof notes === "string" ? notes : candidates[candidateId].notes,
        updatedAt: now
      };
      await saveCandidates(candidates);
      sendResponse({ ok: true });
    } else {
      // Unknown message type
      sendResponse({ ok: false, error: "UNKNOWN_MESSAGE_TYPE" });
    }
  })();

  // Indicate we will respond asynchronously
  return true;
});

