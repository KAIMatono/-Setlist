    import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
    import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
    import { getFirestore, doc, getDoc, setDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

    const cloudBridge = {
      appId: typeof __app_id !== 'undefined' && __app_id ? String(__app_id) : 'sakurazaka46-setlist-default',
      db: null,
      auth: null,
      authUser: null,
      activeProfileId: null,
      unsubscribePrivateDoc: null,
      unsubscribeSharedDoc: null,
      isApplyingRemote: false,
      syncState: 'connecting',
      lastSyncedAt: null
    };

    const STORAGE_KEY_PROFILE_ALIAS = 'sakurazaka46_setlist_profile_id_v1';
    const STORAGE_KEY_ATTENDED = 'sakurazaka46_setlist_attended_v1';
    const STORAGE_KEY_CUSTOM = 'sakurazaka46_setlist_custom_v1';
    const STORAGE_KEY_OVERRIDES = 'sakurazaka46_setlist_overrides_v1';
    const STORAGE_KEY_EXTRA_UNPLAYED = 'sakurazaka46_setlist_extra_unplayed_v1';
    const STORAGE_KEY_HIDDEN_UNPLAYED = 'sakurazaka46_setlist_hidden_unplayed_v1';
    const STORAGE_KEY_ADMIN_UNLOCKED = 'sakurazaka46_setlist_admin_v1';
    const ADMIN_PASSCODE = 'sakura46';

    // Firebase 專案設定（Web 設定值本身可公開，資料存取安全由 Firestore 規則把關）
    const FIREBASE_CONFIG = {
      apiKey: "AIzaSyDbTI5YqtkXzuzgzft3I-cPa79Wyy6LNAA",
      authDomain: "sakurazakasetlist.firebaseapp.com",
      projectId: "sakurazakasetlist",
      storageBucket: "sakurazakasetlist.firebasestorage.app",
      messagingSenderId: "665013839473",
      appId: "1:665013839473:web:bf48472375a9f9dcbe5dd0",
      measurementId: "G-M4CKZQGZ44"
    };
    const COL_PROFILES = 'user_profiles';
    const COL_SHARED = 'shared_setlists';
    const STORAGE_KEY_SYNC_META = 'sakurazaka46_setlist_sync_meta_v1';
    const STORAGE_KEY_CLOUD_OPTIN = 'sakurazaka46_setlist_cloud_optin_v1';
    const STORAGE_KEY_CLOUD_BACKUP = 'sakurazaka46_setlist_backup_before_cloud_v1';
    const SHARED_DOC_SOFT_LIMIT = 900 * 1024;

    function readEmbeddedBuiltinEvents() {
      if (Array.isArray(window.BUILTIN_EVENTS) && window.BUILTIN_EVENTS.length > 0) {
        return window.BUILTIN_EVENTS;
      }
      try {
        const seedEl = document.getElementById('builtin-events-seed');
        if (seedEl && seedEl.textContent) {
          const parsed = JSON.parse(seedEl.textContent);
          if (Array.isArray(parsed)) return parsed;
        }
      } catch (_err) {
        // Ignore invalid embedded JSON
      }
      return [];
    }

    function applyUrlShareParams() {
      try {
        const params = new URLSearchParams(window.location.search || '');
        const urlYear = String(params.get('year') || '').trim();
        const urlCategory = String(params.get('category') || '').trim();
        const urlCatalog = String(params.get('catalog') || '').trim().replace(/[\/#?\[\]]/g, '_');
        const urlAdmin = String(params.get('admin') || '').trim();

        if (/^20\d{2}$/.test(urlYear)) {
          appState.year = urlYear;
        }
        if (['solo', 'festival'].includes(urlCategory)) {
          appState.category = urlCategory;
        }
        if (urlCatalog) {
          cloudBridge.sharedCatalogId = urlCatalog;
        }
        if (urlAdmin === '1' || (ADMIN_PASSCODE && urlAdmin === ADMIN_PASSCODE)) {
          appState.isAdmin = true;
          safeWriteStorage(STORAGE_KEY_ADMIN_UNLOCKED, true);
        }
      } catch (_err) {
        // Ignore malformed URL search parameters
      }
    }

    function buildShareUrl() {
      const url = new URL(window.location.href);
      url.searchParams.delete('profile');
      url.searchParams.delete('admin');
      if (appState.year && appState.year !== 'ALL') {
        url.searchParams.set('year', appState.year);
      } else {
        url.searchParams.delete('year');
      }
      if (appState.category && appState.category !== 'ALL') {
        url.searchParams.set('category', appState.category);
      } else {
        url.searchParams.delete('category');
      }
      if (cloudBridge.sharedCatalogId && cloudBridge.sharedCatalogId !== 'shared_catalog') {
        url.searchParams.set('catalog', cloudBridge.sharedCatalogId);
      } else {
        url.searchParams.delete('catalog');
      }
      return url.toString();
    }

    function shareAppLink() {
      const shareUrl = buildShareUrl();
      const tempInput = document.createElement('textarea');
      tempInput.value = shareUrl;
      tempInput.setAttribute('readonly', '');
      tempInput.style.position = 'fixed';
      tempInput.style.opacity = '0';
      document.body.appendChild(tempInput);
      tempInput.select();
      try {
        const ok = document.execCommand('copy');
        if (ok) {
          showToast('已複製分享連結');
        } else {
          showToast(`分享連結：${shareUrl}`);
        }
      } catch (_err) {
        showToast(`分享連結：${shareUrl}`);
      } finally {
        tempInput.remove();
      }
    }

    const BUILTIN_EVENTS = readEmbeddedBuiltinEvents();

    const SAKURAZAKA46_FULL_SONGS = [
      "Nobody's fault",
      "なぜ 恋をして来なかったんだろう？",
      "半信半疑",
      "Plastic regret",
      "最終の地下鉄に乗って",
      "Buddies",
      "ブルームーンキス",
      "BAN",
      "偶然の答え",
      "それが愛なのね",
      "君と僕と洗濯物",
      "Microscope",
      "思ったよりも寂しくない",
      "櫻坂の詩",
      "流れ弾",
      "Dead end",
      "ソニア",
      "ジャマイカビール",
      "On my way",
      "無言の宇宙",
      "美しきNervous",
      "五月雨よ",
      "僕のジレンマ",
      "I'm in",
      "断絶",
      "制服の人魚",
      "車間距離",
      "恋が絶滅する日",
      "摩擦係数",
      "条件反射で泣けて来る",
      "One-way stairs",
      "タイムマシーンでYeah!",
      "ずっと 春だったらなあ",
      "その日まで",
      "桜月",
      "Cool",
      "無念",
      "もしかしたら真実",
      "魂のLiar",
      "夏の近道",
      "Start over!",
      "静寂の暴力",
      "風の音",
      "コンビナート",
      "Anthem time",
      "一瞬の馬",
      "ドローン旋回中",
      "承認欲求",
      "マモリビト",
      "確信的クロワッサン",
      "僕たちの La vie en rose",
      "Don't cut in line!",
      "マンホールの蓋の上",
      "隙間風よ",
      "君がサヨナラ言えたって・・・",
      "何歳の頃に戻りたいのか？",
      "何度 LOVE SONGの歌詞を読み返しただろう",
      "油を注せ！",
      "真夏に何か起きるのかしら",
      "心の影絵",
      "恋は向いてない",
      "泣かせて Hold me tight!",
      "自業自得",
      "引きこもる時間はない",
      "愛し合いなさい",
      "イザベルについて",
      "縁起担ぎ",
      "標識",
      "もう一曲 欲しいのかい？",
      "I want tomorrow to come",
      "本質的なこと",
      "僕は僕を好きになれない",
      "今さらSuddenly",
      "嵐の前、世界の終わり",
      "19歳のガレット",
      "TOKYO SNOW",
      "ピッカーン！",
      "UDAGAWA GENERATION",
      "Nightmare症候群",
      "Nothing special",
      "紋白蝶が確か飛んでた",
      "行かないで",
      "ULTRAVIOLET",
      "やるしかないじゃん",
      "Addiction",
      "Make or Break",
      "死んだふり",
      "港区パセリ",
      "恋愛無双",
      "真夏の大統領",
      "君のことを想いながら",
      "ノンアルコール",
      "Unhappy birthday構文",
      "Alter ego",
      "木枯らしは泣かない",
      "青空が見えるまで",
      "I will be",
      "Buddies (English Version)",
      "夜空で一番輝いてる星の名前を僕は知らない",
      "The growing up train",
      "光源",
      "ドライフルーツ",
      "キスが苦い",
      "くらげらしく",
      "Sunny side up",
      "僕は向いてない",
      "Lonesome rabbit",
      "What's “KAZOKU”?",
      "コインランドリー",
      "We got your back",
      "狼たちよ",
      "各駅停車",
      "恵まれ過ぎて",
      "愛MUST BE",
      "元凶",
      "自称バレエダンサー",
      "アベセン",
      "1mmも飛ばない鳥",
      "あの日の私で",
      "I'm the law"
    ];

    function normalizeSongKey(title) {
      return String(title || '')
        .trim()
        .toLowerCase()
        .replace(/？/g, '?')
        .replace(/！/g, '!')
        .replace(/[’‘]/g, "'")
        .replace(/[“”]/g, '"')
        .replace(/、/g, ',')
        .replace(/\s+/g, ' ');
    }

    const appState = {
      activeTab: 'events',
      isAdmin: false,
      year: 'ALL',
      category: 'ALL',
      series: 'ALL',
      attendedOnly: false,
      songSortMode: 'count',
      showAllRanking: false,
      showAllUnplayed: false,
      expandedIds: new Set(),
      attendedIds: new Set(),
      customEvents: [],
      eventOverrides: {},
      extraUnplayedSongs: [],
      hiddenUnplayedKeys: new Set(),
      draftBgImages: {
        custom: '',
        edit: ''
      }
    };

    function safeReadStorage(key, fallback) {
      try {
        const raw = window.localStorage.getItem(key);
        if (raw === null || raw === undefined) return fallback;
        return JSON.parse(raw);
      } catch (_err) {
        return fallback;
      }
    }

    function safeWriteStorage(key, value) {
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
      } catch (_err) {
        // Ignore storage quota or sandbox restrictions
      }
    }

    function updateSyncUi() {
      const dot = document.getElementById('sync-status-dot');
      const label = document.getElementById('sync-status-label');
      const badge = document.getElementById('modal-sync-badge');
      const idEl = document.getElementById('modal-full-userid');
      const summaryEl = document.getElementById('stats-sync-summary');

      const optedIn = isCloudOptedIn();
      const effectiveId = cloudBridge.activeProfileId || (optedIn ? '尚未連線' : '尚未啟用雲端同步');

      if (idEl) {
        idEl.textContent = effectiveId;
      }

      if (dot && label && badge) {
        if (cloudBridge.syncState === 'synced') {
          dot.className = 'w-2 h-2 rounded-full bg-emerald-500';
          label.textContent = '已同步';
          badge.textContent = '雲端已同步';
          badge.className = 'px-2.5 py-0.5 rounded-full text-xs font-black bg-emerald-50 text-emerald-700 border border-emerald-200';
        } else if (cloudBridge.syncState === 'connecting') {
          dot.className = 'w-2 h-2 rounded-full bg-amber-400';
          label.textContent = '同步中';
          badge.textContent = '連線同步中...';
          badge.className = 'px-2.5 py-0.5 rounded-full text-xs font-black bg-amber-50 text-amber-700 border border-amber-200';
        } else {
          dot.className = 'w-2 h-2 rounded-full bg-rose-400';
          label.textContent = '本機模式';
          badge.textContent = optedIn ? '本機暫存（離線/未設定）' : '本機模式（未啟用雲端同步）';
          badge.className = 'px-2.5 py-0.5 rounded-full text-xs font-black bg-rose-50 text-[#C96A88] border border-[#F6DCE4]';
        }
      }

      if (summaryEl) {
        const timeText = cloudBridge.lastSyncedAt ? `（上次同步：${cloudBridge.lastSyncedAt}）` : '';
        summaryEl.textContent = (!optedIn && !cloudBridge.activeProfileId)
          ? '目前為本機模式：紀錄只存在這台裝置。想跨裝置同步，請點上方「本機模式」，輸入你自己的同步 ID 後啟用。'
          : `同步 ID：${effectiveId} ${timeText}。歌單與新增場次會同步給大家；參戰紀錄僅限你的同步 ID 跨裝置同步。`;
      }
    }

    // ---- Firestore 路徑 ----
    // 個人參戰紀錄：user_profiles/{userId}
    // 共用歌單／新增場次：shared_setlists/{docKey}
    function getPrivateUserDocRef(profileId) {
      if (!cloudBridge.db || !profileId) return null;
      return doc(cloudBridge.db, COL_PROFILES, String(profileId));
    }

    function getSharedSetlistDocRef() {
      if (!cloudBridge.db) return null;
      const docKey = cloudBridge.sharedCatalogId || 'shared_catalog';
      return doc(cloudBridge.db, COL_SHARED, docKey);
    }

    // ---- 同步時間戳（本機） ----
    function readSyncMeta() {
      const m = safeReadStorage(STORAGE_KEY_SYNC_META, {});
      return {
        attendance: {
          clientUpdatedAt: Number(m && m.attendance && m.attendance.clientUpdatedAt) || 0,
          profileId: String((m && m.attendance && m.attendance.profileId) || '')
        },
        setlist: {
          clientUpdatedAt: Number(m && m.setlist && m.setlist.clientUpdatedAt) || 0
        }
      };
    }

    function writeSyncMeta(meta) {
      safeWriteStorage(STORAGE_KEY_SYNC_META, meta);
    }

    // 本機有實際修改時呼叫；時間戳單調遞增，避免裝置時鐘落後時被雲端舊資料蓋過
    function touchLocalMeta(scope) {
      const meta = readSyncMeta();
      const now = Date.now();
      if (scope === 'attendance' || scope === 'all') {
        meta.attendance.clientUpdatedAt = Math.max(now, meta.attendance.clientUpdatedAt + 1);
      }
      if (scope === 'setlist' || scope === 'all') {
        meta.setlist.clientUpdatedAt = Math.max(now, meta.setlist.clientUpdatedAt + 1);
      }
      writeSyncMeta(meta);
    }

    function remoteClientTs(data) {
      if (!data || typeof data !== 'object') return 0;
      const c = Number(data.clientUpdatedAt);
      if (Number.isFinite(c) && c > 0) return c;
      const u = data.updatedAt;
      if (u && typeof u.toMillis === 'function') return u.toMillis();
      if (typeof u === 'string') {
        const p = Date.parse(u);
        if (Number.isFinite(p)) return p;
      }
      return 0;
    }

    function markCloudSynced() {
      cloudBridge.lastSyncedAt = new Date().toLocaleTimeString('zh-Hant', { hour12: false });
      cloudBridge.syncState = 'synced';
      updateSyncUi();
    }

    function markCloudError(err, where) {
      console.warn('[cloud]', where || '', (err && (err.code || err.message)) || err);
      cloudBridge.syncState = 'error';
      updateSyncUi();
    }

    // ---- 內容比對與本機備份 ----
    function localAttendanceHasData() {
      return appState.attendedIds.size > 0 ||
        appState.extraUnplayedSongs.length > 0 ||
        appState.hiddenUnplayedKeys.size > 0;
    }

    function attendanceEquals(data) {
      const a = JSON.stringify([...appState.attendedIds].sort());
      const b = JSON.stringify((Array.isArray(data && data.attendedIds) ? data.attendedIds.map(String) : []).sort());
      return a === b;
    }

    function localSetlistHasData() {
      return appState.customEvents.length > 0 || Object.keys(appState.eventOverrides).length > 0;
    }

    function sharedContentEquals(data) {
      const local = JSON.stringify({
        customEvents: appState.customEvents,
        eventOverrides: appState.eventOverrides
      });
      const remote = JSON.stringify({
        customEvents: Array.isArray(data && data.customEvents) ? data.customEvents : [],
        eventOverrides: (data && data.eventOverrides && typeof data.eventOverrides === 'object' && !Array.isArray(data.eventOverrides)) ? data.eventOverrides : {}
      });
      return local === remote;
    }

    // 以雲端資料取代本機前，先把本機內容留一份備份（只保留最近一份）
    function backupLocalBeforeCloudOverwrite(scope) {
      try {
        if (scope === 'attendance') {
          safeWriteStorage(STORAGE_KEY_CLOUD_BACKUP + '_attendance', {
            savedAt: new Date().toISOString(),
            attendedIds: [...appState.attendedIds],
            extraUnplayedSongs: appState.extraUnplayedSongs,
            hiddenUnplayedKeys: [...appState.hiddenUnplayedKeys]
          });
        } else {
          safeWriteStorage(STORAGE_KEY_CLOUD_BACKUP + '_setlist', {
            savedAt: new Date().toISOString(),
            customEvents: appState.customEvents,
            eventOverrides: appState.eventOverrides
          });
        }
      } catch (_err) {
        // 備份失敗不影響同步
      }
    }

    // ---- 序列化（寫入雲端）----
    // updatedAt：Firestore 伺服器時間；clientUpdatedAt：本機最後修改時間（毫秒），用於跨裝置新舊比對
    function serializePrivateAttendance() {
      const meta = readSyncMeta();
      return {
        attendedIds: [...appState.attendedIds],
        extraUnplayedSongs: appState.extraUnplayedSongs,
        hiddenUnplayedKeys: [...appState.hiddenUnplayedKeys],
        clientUpdatedAt: meta.attendance.clientUpdatedAt || Date.now(),
        updatedAt: serverTimestamp()
      };
    }

    function serializeSharedSetlists() {
      const meta = readSyncMeta();
      return {
        customEvents: appState.customEvents,
        eventOverrides: appState.eventOverrides,
        clientUpdatedAt: meta.setlist.clientUpdatedAt || Date.now(),
        updatedAt: serverTimestamp()
      };
    }

    // ---- 套用雲端資料到本機 ----
    function applyPrivateAttendancePayload(data) {
      if (!data || typeof data !== 'object') return;
      cloudBridge.isApplyingRemote = true;
      try {
        const nextAttended = Array.isArray(data.attendedIds) ? data.attendedIds.map(String) : [];
        appState.attendedIds = new Set(nextAttended);

        if (Array.isArray(data.extraUnplayedSongs)) {
          appState.extraUnplayedSongs = data.extraUnplayedSongs.map(String).map(s => s.trim()).filter(Boolean);
        }
        if (Array.isArray(data.hiddenUnplayedKeys)) {
          appState.hiddenUnplayedKeys = new Set(data.hiddenUnplayedKeys.map(String));
        }

        persistState(false, 'attendance');

        const meta = readSyncMeta();
        meta.attendance = {
          clientUpdatedAt: remoteClientTs(data),
          profileId: String(cloudBridge.activeProfileId || '')
        };
        writeSyncMeta(meta);

        updateAttendedBadge();
        renderEvents();
        if (appState.activeTab === 'stats') {
          renderStats();
        }
        markCloudSynced();
      } finally {
        cloudBridge.isApplyingRemote = false;
      }
    }

    function applySharedSetlistPayload(data) {
      if (!data || typeof data !== 'object') return;
      cloudBridge.isApplyingRemote = true;
      try {
        const nextCustom = Array.isArray(data.customEvents)
          ? data.customEvents.filter(ev => ev && ev.id && ev.title && Array.isArray(ev.setlist))
          : [];
        const nextOverrides = (data.eventOverrides && typeof data.eventOverrides === 'object' && !Array.isArray(data.eventOverrides))
          ? data.eventOverrides
          : {};

        appState.customEvents = nextCustom;
        appState.eventOverrides = nextOverrides;

        persistState(false, 'setlist');

        const meta = readSyncMeta();
        meta.setlist.clientUpdatedAt = remoteClientTs(data);
        writeSyncMeta(meta);

        renderFilters();
        renderEvents();
        if (appState.activeTab === 'stats') {
          renderStats();
        }
        markCloudSynced();
      } finally {
        cloudBridge.isApplyingRemote = false;
      }
    }

    // ---- 寫入雲端 ----
    async function pushPrivateAttendanceToCloud(notifyUser = false) {
      if (cloudBridge.isApplyingRemote) return;
      if (!cloudBridge.authUser || !cloudBridge.db || !cloudBridge.activeProfileId) return;

      // 本機快取尚未與目前個人空間對齊時，不直接寫入，交給連線時的比對流程處理
      const meta = readSyncMeta();
      if (meta.attendance.profileId !== String(cloudBridge.activeProfileId)) return;

      const docRef = getPrivateUserDocRef(cloudBridge.activeProfileId);
      if (!docRef) return;

      try {
        await setDoc(docRef, serializePrivateAttendance(), { merge: true });
        markCloudSynced();
        if (notifyUser) {
          showToast('已同步個人參戰與曲目紀錄');
        }
      } catch (err) {
        markCloudError(err, 'push attendance');
        if (notifyUser) {
          showToast('雲端同步失敗，已保留本機紀錄');
        }
      }
    }

    async function pushSharedSetlistsToCloud(notifyUser = false) {
      if (cloudBridge.isApplyingRemote) return;
      // 只有管理模式才會寫入共用歌單，一般使用者的操作不會影響大家看到的內容
      if (!appState.isAdmin) return;
      if (!cloudBridge.authUser || !cloudBridge.db) {
        showToast('目前是本機模式，修改只存在這台裝置；啟用雲端同步後才會分享給大家');
        return;
      }

      const docRef = getSharedSetlistDocRef();
      if (!docRef) return;

      // Firestore 單一文件上限 1 MB，超過時不寫入並提醒
      const approxSize = new Blob([JSON.stringify({
        customEvents: appState.customEvents,
        eventOverrides: appState.eventOverrides
      })]).size;
      if (approxSize > SHARED_DOC_SOFT_LIMIT) {
        markCloudError(new Error('shared setlist too large: ' + approxSize), 'push shared');
        showToast('共用歌單資料量過大（含圖片），無法同步到雲端，已保留本機修改');
        return;
      }

      try {
        await setDoc(docRef, serializeSharedSetlists(), { merge: true });
        markCloudSynced();
        if (notifyUser) {
          showToast('已同步共用歌單更新');
        }
      } catch (err) {
        markCloudError(err, 'push shared');
        if (notifyUser) {
          showToast('共用歌單同步失敗，已保留本機修改');
        }
      }
    }

    // ---- 連線時的新舊比對 ----
    async function reconcileSharedSetlists(sharedRef, snap) {
      const meta = readSyncMeta();
      const localTs = meta.setlist.clientUpdatedAt;

      if (!snap.exists()) {
        if (appState.isAdmin && localSetlistHasData()) {
          meta.setlist.clientUpdatedAt = localTs || Date.now();
          writeSyncMeta(meta);
          await setDoc(sharedRef, serializeSharedSetlists());
        }
        markCloudSynced();
        return;
      }

      const data = snap.data();
      const remoteTs = remoteClientTs(data);

      if (remoteTs > localTs || (!appState.isAdmin && !sharedContentEquals(data))) {
        if (localSetlistHasData() && !sharedContentEquals(data)) {
          backupLocalBeforeCloudOverwrite('setlist');
        }
        applySharedSetlistPayload(data);
      } else if (localTs > remoteTs && appState.isAdmin) {
        await setDoc(sharedRef, serializeSharedSetlists(), { merge: true });
        markCloudSynced();
      } else {
        markCloudSynced();
      }
    }

    async function reconcileAttendance(docRef, snap, profileId) {
      const meta = readSyncMeta();
      const bound = meta.attendance.profileId === String(profileId);

      if (!snap.exists()) {
        // 雲端尚無此個人空間：以目前本機紀錄建立
        meta.attendance = {
          clientUpdatedAt: (bound && meta.attendance.clientUpdatedAt) || Date.now(),
          profileId: String(profileId)
        };
        writeSyncMeta(meta);
        await setDoc(docRef, serializePrivateAttendance());
        markCloudSynced();
        return;
      }

      const data = snap.data();
      const remoteTs = remoteClientTs(data);
      // 本機快取不是屬於這個個人空間時，視為沒有可信的本機時間戳，一律以雲端為準
      const localTs = bound ? meta.attendance.clientUpdatedAt : 0;

      if (remoteTs > localTs || (!bound && !attendanceEquals(data))) {
        const hadLocal = localAttendanceHasData() && !attendanceEquals(data);
        if (hadLocal) {
          backupLocalBeforeCloudOverwrite('attendance');
        }
        applyPrivateAttendancePayload(data);
        if (hadLocal && !bound) {
          showToast('已套用雲端的參戰紀錄（本機原有紀錄已另外備份）');
        }
      } else if (localTs > remoteTs) {
        // 本機較新（例如離線期間有修改）：寫回雲端
        meta.attendance.profileId = String(profileId);
        writeSyncMeta(meta);
        await setDoc(docRef, serializePrivateAttendance(), { merge: true });
        markCloudSynced();
      } else {
        meta.attendance.profileId = String(profileId);
        writeSyncMeta(meta);
        markCloudSynced();
      }
    }

    async function subscribeToSharedSetlists() {
      if (cloudBridge.unsubscribeSharedDoc) {
        cloudBridge.unsubscribeSharedDoc();
        cloudBridge.unsubscribeSharedDoc = null;
      }

      if (!cloudBridge.authUser || !cloudBridge.db) return;
      const sharedRef = getSharedSetlistDocRef();
      if (!sharedRef) return;

      try {
        const snap = await getDoc(sharedRef);
        await reconcileSharedSetlists(sharedRef, snap);
      } catch (err) {
        markCloudError(err, 'shared reconcile');
      }

      cloudBridge.unsubscribeSharedDoc = onSnapshot(
        sharedRef,
        (snapshot) => {
          if (!snapshot.exists()) return;
          if (snapshot.metadata && snapshot.metadata.hasPendingWrites) return;
          const remoteData = snapshot.data();
          const meta = readSyncMeta();
          const remoteTs = remoteClientTs(remoteData);

          if (remoteTs > meta.setlist.clientUpdatedAt || (!appState.isAdmin && !sharedContentEquals(remoteData))) {
            applySharedSetlistPayload(remoteData);
          } else {
            markCloudSynced();
          }
        },
        (err) => {
          markCloudError(err, 'shared listener');
        }
      );
    }

    async function subscribeToProfile(profileId) {
      if (cloudBridge.unsubscribePrivateDoc) {
        cloudBridge.unsubscribePrivateDoc();
        cloudBridge.unsubscribePrivateDoc = null;
      }

      cloudBridge.activeProfileId = profileId;
      updateSyncUi();

      if (!cloudBridge.authUser || !cloudBridge.db || !profileId) return;

      await subscribeToSharedSetlists();

      const docRef = getPrivateUserDocRef(profileId);
      if (!docRef) return;

      try {
        const snap = await getDoc(docRef);
        await reconcileAttendance(docRef, snap, profileId);
      } catch (err) {
        markCloudError(err, 'profile reconcile');
      }

      cloudBridge.unsubscribePrivateDoc = onSnapshot(
        docRef,
        (snapshot) => {
          if (!snapshot.exists()) return;
          if (snapshot.metadata && snapshot.metadata.hasPendingWrites) return;
          const meta = readSyncMeta();
          if (meta.attendance.profileId !== String(cloudBridge.activeProfileId)) return;
          const remoteData = snapshot.data();
          const remoteTs = remoteClientTs(remoteData);

          if (remoteTs > meta.attendance.clientUpdatedAt) {
            applyPrivateAttendancePayload(remoteData);
          } else {
            markCloudSynced();
          }
        },
        (err) => {
          markCloudError(err, 'profile listener');
        }
      );
    }

    // ---- 雲端同步改為「使用者主動啟用」----
    // 一般訪客預設只用本機，不會連線 Firebase、不會建立匿名帳號，也不會在資料庫產生任何文件。
    // 使用者要同步時，在「個人帳號與跨裝置同步」輸入自己的同步 ID 並確認，才會啟用。
    function isCloudOptedIn() {
      const flag = safeReadStorage(STORAGE_KEY_CLOUD_OPTIN, null);
      if (flag === true) return true;
      if (flag === false) return false; // 使用者明確停用過
      // 舊版曾自動綁定、且這台裝置有實際紀錄者，沿用原本設定，避免中斷既有同步
      const meta = readSyncMeta();
      return !!meta.attendance.profileId && (appState.attendedIds.size > 0 || appState.isAdmin);
    }

    function getSavedProfileId() {
      const alias = String(safeReadStorage(STORAGE_KEY_PROFILE_ALIAS, '') || '').trim();
      return alias || readSyncMeta().attendance.profileId || '';
    }

    function validateProfileId(raw) {
      const id = String(raw || '').trim().replace(/[\/#?\[\]\\\s]+/g, '_');
      if (id.length < 6) {
        return { ok: false, msg: '同步 ID 至少需要 6 個字元，建議用不易被猜到的組合' };
      }
      if (id.length > 80) {
        return { ok: false, msg: '同步 ID 最長 80 個字元' };
      }
      if (/^\.+$/.test(id) || /^__.*__$/.test(id)) {
        return { ok: false, msg: '這個 ID 格式不可使用，請換一個' };
      }
      return { ok: true, id };
    }

    // 初始化 Firebase 並匿名登入（只在使用者啟用同步後才會呼叫）
    async function ensureCloudReady() {
      if (cloudBridge.db && cloudBridge.authUser) return true;
      try {
        const firebaseConfig = (typeof __firebase_config !== 'undefined' && __firebase_config)
          ? JSON.parse(__firebase_config)
          : FIREBASE_CONFIG;
        if (!cloudBridge.db) {
          const app = initializeApp(firebaseConfig);
          cloudBridge.auth = getAuth(app);
          cloudBridge.db = getFirestore(app);
        }
        if (!cloudBridge.authUser) {
          if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
            const cred = await signInWithCustomToken(cloudBridge.auth, __initial_auth_token);
            cloudBridge.authUser = cred.user;
          } else {
            const cred = await signInAnonymously(cloudBridge.auth);
            cloudBridge.authUser = cred.user;
          }
        }
        return !!cloudBridge.authUser;
      } catch (err) {
        console.warn('[cloud] init failed', (err && (err.code || err.message)) || err);
        cloudBridge.syncState = 'offline';
        updateSyncUi();
        return false;
      }
    }

    // 載入網頁時呼叫：未啟用同步就維持本機模式
    async function initCloudSync() {
      if (!isCloudOptedIn()) {
        cloudBridge.syncState = 'offline';
        updateSyncUi();
        return;
      }
      const profileId = getSavedProfileId();
      if (!profileId) {
        cloudBridge.syncState = 'offline';
        updateSyncUi();
        return;
      }
      cloudBridge.syncState = 'connecting';
      updateSyncUi();
      if (!(await ensureCloudReady())) return;
      await subscribeToProfile(profileId);
    }

    async function connectToCloudProfile(profileId) {
      const prevState = cloudBridge.syncState;
      cloudBridge.syncState = 'connecting';
      updateSyncUi();

      if (!(await ensureCloudReady())) {
        showToast('無法連線到雲端，仍使用本機模式');
        cloudBridge.syncState = 'offline';
        updateSyncUi();
        return false;
      }

      const alreadyMine = readSyncMeta().attendance.profileId === String(profileId);
      if (!alreadyMine) {
        // 先確認這個 ID 在雲端是否已有資料，避免不小心連到別人的空間或覆蓋自己的紀錄
        try {
          const snap = await getDoc(getPrivateUserDocRef(profileId));
          let agreed;
          if (snap.exists()) {
            const data = snap.data() || {};
            const n = Array.isArray(data.attendedIds) ? data.attendedIds.length : 0;
            agreed = window.confirm(
              `這個 ID 在雲端已有資料（${n} 場參戰紀錄）。\n連結後會以雲端紀錄為準，這台裝置目前的紀錄會另外備份。\n\n確定要連結嗎？`
            );
          } else {
            agreed = window.confirm(
              '雲端目前沒有這個 ID 的資料。\n要用這個 ID 建立新的雲端空間，並上傳這台裝置目前的紀錄嗎？\n\n提醒：知道這個 ID 的人都能讀寫這份紀錄，請不要使用容易被猜到的 ID。'
            );
          }
          if (!agreed) {
            cloudBridge.syncState = prevState === 'synced' ? 'synced' : 'offline';
            updateSyncUi();
            return false;
          }
        } catch (err) {
          markCloudError(err, 'check profile');
          showToast('無法檢查雲端資料，請稍後再試（可按 F12 查看 [cloud] 訊息）');
          return false;
        }
      }

      safeWriteStorage(STORAGE_KEY_PROFILE_ALIAS, profileId);
      safeWriteStorage(STORAGE_KEY_CLOUD_OPTIN, true);
      await subscribeToProfile(profileId);
      window.closeAccountModal();
      showToast(cloudBridge.syncState === 'synced'
        ? `已連結並同步：${profileId}`
        : '雲端同步失敗，已保留本機紀錄');
      return cloudBridge.syncState === 'synced';
    }

    window.openAccountModal = function () {
      const modal = document.getElementById('account-modal');
      const input = document.getElementById('cross-device-id-input');
      const optedIn = isCloudOptedIn();
      if (input) {
        input.value = cloudBridge.activeProfileId || '';
        input.placeholder = '輸入你自己的同步 ID（至少 6 個字元，例如：sakurazaka-setlist）';
      }
      if (modal) {
        const submitBtn = modal.querySelector('button[type="submit"]');
        if (submitBtn) submitBtn.textContent = optedIn ? '切換並同步' : '啟用並同步';
        const randomBtn = modal.querySelector('[onclick*="createNewAnonymousProfile"]');
        if (randomBtn) randomBtn.textContent = '幫我產生一組隨機 ID';

        let disableBtn = document.getElementById('disable-cloud-sync-btn');
        const form = modal.querySelector('form');
        if (!disableBtn && form && form.parentNode) {
          disableBtn = document.createElement('button');
          disableBtn.type = 'button';
          disableBtn.id = 'disable-cloud-sync-btn';
          disableBtn.className = 'w-full px-3 py-2 rounded-xl bg-white hover:bg-rose-50 text-[#C96A88] text-xs font-bold border border-[#F6DCE4] cursor-pointer';
          disableBtn.textContent = '停止雲端同步（改回只用本機）';
          disableBtn.onclick = () => window.disableCloudSync();
          form.parentNode.appendChild(disableBtn);
        }
        if (disableBtn) disableBtn.style.display = optedIn ? '' : 'none';
      }
      updateSyncUi();
      if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
      }
    };

    window.closeAccountModal = function () {
      const modal = document.getElementById('account-modal');
      if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
      }
    };

    window.handleAccountBackdropClick = function (e) {
      if (e.target && e.target.id === 'account-modal') {
        window.closeAccountModal();
      }
    };

    window.copyCurrentUserId = function () {
      const idText = cloudBridge.activeProfileId || '';
      if (!idText) {
        showToast('尚未啟用雲端同步，沒有可複製的同步 ID');
        return;
      }
      const tempInput = document.createElement('textarea');
      tempInput.value = idText;
      document.body.appendChild(tempInput);
      tempInput.select();
      try {
        document.execCommand('copy');
        showToast('已複製同步 ID');
      } catch (_err) {
        showToast('複製失敗，請手動選取複製');
      } finally {
        tempInput.remove();
      }
    };

    window.switchCrossDeviceProfile = async function (e) {
      if (e && e.preventDefault) e.preventDefault();
      const input = document.getElementById('cross-device-id-input');
      const v = validateProfileId(input ? input.value : '');
      if (!v.ok) {
        showToast(v.msg);
        return;
      }
      await connectToCloudProfile(v.id);
    };

    window.createNewAnonymousProfile = async function () {
      const freshId = `buddy-${crypto.randomUUID()}`;
      const input = document.getElementById('cross-device-id-input');
      if (input) input.value = freshId;
      await connectToCloudProfile(freshId);
    };

    window.disableCloudSync = function () {
      if (!window.confirm('要停止雲端同步嗎？\n資料會保留在這台裝置，之後可以再輸入同步 ID 重新啟用。')) return;
      if (cloudBridge.unsubscribePrivateDoc) {
        cloudBridge.unsubscribePrivateDoc();
        cloudBridge.unsubscribePrivateDoc = null;
      }
      if (cloudBridge.unsubscribeSharedDoc) {
        cloudBridge.unsubscribeSharedDoc();
        cloudBridge.unsubscribeSharedDoc = null;
      }
      safeWriteStorage(STORAGE_KEY_CLOUD_OPTIN, false);
      cloudBridge.authUser = null;
      cloudBridge.activeProfileId = null;
      cloudBridge.syncState = 'offline';
      updateSyncUi();
      window.closeAccountModal();
      showToast('已停止雲端同步，資料仍保留在這台裝置');
    };

    // ---- 分享參戰：直接用統計資料產生，不再從畫面文字解析 ----
    // 覆蓋 index.html 內 getUserReportStats()（原本靠 document.body.innerText 解析，
    // 統計頁沒顯示或排版改變時會抓不到 Top 5）。
    window.getUserReportStats = function () {
      const stats = computeAttendanceStats();
      const nickname = (typeof window.getSavedNickname === 'function') ? window.getSavedNickname() : '';
      const top = stats.rankedSongs[0];
      return {
        badgeText: nickname ? ` ${nickname}` : '',
        totalLives: stats.attendedCount,
        liveDetail: `單獨 ${stats.soloCount} / 音樂祭 ${stats.festivalCount}`,
        totalSongs: stats.totalPlays,
        unlockedCount: stats.uniqueHeard,
        totalCatalog: stats.totalCatalog,
        unlockRate: `${stats.completionPct}%`,
        topSongName: top ? top.title : '尚未加入參戰場次',
        topSongSub: top ? `${top.count} 次（參戰場次出現率 ${top.ratioPct}%）` : '—',
        yearCounts: Object.keys(stats.yearlyCounts).map(y => ({ year: y, count: stats.yearlyCounts[y] })),
        top5: stats.rankedSongs.slice(0, 5).map(s => ({
          title: s.title,
          metric: `${s.count} 次 · ${s.ratioPct}%`
        }))
      };
    };

    window.syncNowToCloud = async function (notifyUser = true) {
      if (!cloudBridge.authUser || !cloudBridge.db || !cloudBridge.activeProfileId) {
        if (notifyUser) showToast('尚未連線到雲端，目前為本機模式');
        return;
      }
      // 重新比對雲端與本機：雲端較新則套用，本機較新則寫回
      cloudBridge.syncState = 'connecting';
      updateSyncUi();
      await subscribeToProfile(cloudBridge.activeProfileId);
      if (notifyUser) {
        showToast(cloudBridge.syncState === 'synced'
          ? '已完成共用歌單與個人參戰同步'
          : '雲端同步失敗，已保留本機紀錄');
      }
    };

    window.__onLocalStateMutated = function (scope = 'all') {
      if (scope === 'attendance') {
        pushPrivateAttendanceToCloud(false);
      } else if (scope === 'setlist') {
        pushSharedSetlistsToCloud(false);
      } else {
        pushSharedSetlistsToCloud(false);
        pushPrivateAttendanceToCloud(false);
      }
    };

    function loadPersistedState() {
      const savedAdmin = safeReadStorage(STORAGE_KEY_ADMIN_UNLOCKED, false);
      appState.isAdmin = Boolean(savedAdmin);
      const savedAttended = safeReadStorage(STORAGE_KEY_ATTENDED, []);
      const savedCustom = safeReadStorage(STORAGE_KEY_CUSTOM, []);
      const savedOverrides = safeReadStorage(STORAGE_KEY_OVERRIDES, {});
      const savedExtraUnplayed = safeReadStorage(STORAGE_KEY_EXTRA_UNPLAYED, []);
      const savedHiddenUnplayed = safeReadStorage(STORAGE_KEY_HIDDEN_UNPLAYED, []);

      appState.attendedIds = new Set(Array.isArray(savedAttended) ? savedAttended.map(String) : []);
      appState.extraUnplayedSongs = Array.isArray(savedExtraUnplayed)
        ? savedExtraUnplayed.map(s => String(s || '').trim()).filter(Boolean)
        : [];
      appState.hiddenUnplayedKeys = new Set(
        Array.isArray(savedHiddenUnplayed) ? savedHiddenUnplayed.map(String) : []
      );
      appState.customEvents = Array.isArray(savedCustom)
        ? savedCustom.filter(ev => ev && ev.id && Array.isArray(ev.setlist)).map(ev => ({
            ...ev,
            bgImage: typeof ev.bgImage === 'string' ? ev.bgImage : ''
          }))
        : [];
      const cleanOverrides = {};
      if (savedOverrides && typeof savedOverrides === 'object' && !Array.isArray(savedOverrides)) {
        for (const [key, val] of Object.entries(savedOverrides)) {
          if (val && typeof val === 'object') {
            cleanOverrides[key] = {
              ...val,
              bgImage: typeof val.bgImage === 'string' ? val.bgImage : ''
            };
          }
        }
      }
      appState.eventOverrides = cleanOverrides;
    }

    function updateAdminUi() {
      const addBtn = document.getElementById('header-add-event-btn');
      const banner = document.getElementById('admin-banner');
      const modeBtn = document.getElementById('admin-mode-btn');
      const modeLabel = document.getElementById('admin-mode-label');

      if (addBtn) {
        addBtn.classList.toggle('hidden', !appState.isAdmin);
        addBtn.classList.toggle('flex', appState.isAdmin);
      }
      if (banner) {
        banner.classList.toggle('hidden', !appState.isAdmin);
      }
      if (modeBtn && modeLabel) {
        if (appState.isAdmin) {
          modeBtn.className = 'px-2.5 py-2 rounded-xl bg-[#FDE7EE] text-[#C96A88] border border-[#F19DB5] text-xs font-extrabold transition flex items-center gap-1 cursor-pointer';
          modeLabel.textContent = '管理中';
        } else {
          modeBtn.className = 'px-2.5 py-2 rounded-xl bg-[#FFF5F8] hover:bg-[#FDE7EE] text-[#6E535C] border border-[#F6DCE4] text-xs font-extrabold transition flex items-center gap-1 cursor-pointer';
          modeLabel.textContent = '管理';
        }
      }
      const unplayedForm = document.getElementById('unplayed-add-form');
      if (unplayedForm) {
        unplayedForm.classList.toggle('hidden', !appState.isAdmin);
        unplayedForm.classList.toggle('flex', appState.isAdmin);
      }
      const unplayedDesc = document.getElementById('unplayed-desc');
      if (unplayedDesc) {
        unplayedDesc.textContent = appState.isAdmin
          ? '對照櫻坂46全曲資料庫中尚未解鎖的曲目，可新增或移除曲目'
          : '對照櫻坂46全曲資料庫中尚未解鎖的曲目（新增／移除曲目需於管理模式操作）';
      }
    }

    function openAdminModal() {
      if (appState.isAdmin) {
        showToast('目前已處於後台管理模式');
        return;
      }
      const modal = document.getElementById('admin-modal');
      const input = document.getElementById('admin-pin-input');
      if (input) input.value = '';
      if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        setTimeout(() => input && input.focus(), 50);
      }
    }

    function closeAdminModal() {
      const modal = document.getElementById('admin-modal');
      if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
      }
    }

    function handleAdminBackdropClick(e) {
      if (e.target && e.target.id === 'admin-modal') {
        closeAdminModal();
      }
    }

    function submitAdminUnlock(e) {
      e.preventDefault();
      const input = document.getElementById('admin-pin-input');
      const code = String(input?.value || '').trim();
      if (!ADMIN_PASSCODE) {
        showToast('尚未設定管理密碼');
        return;
      }
      if (code !== ADMIN_PASSCODE) {
        showToast('管理密碼錯誤');
        return;
      }
      appState.isAdmin = true;
      safeWriteStorage(STORAGE_KEY_ADMIN_UNLOCKED, true);
      updateAdminUi();
      renderEvents();
      if (appState.activeTab === 'stats') renderStats();
      closeAdminModal();
      showToast('已解鎖後台管理模式');
    }

    function exitAdminMode() {
      appState.isAdmin = false;
      safeWriteStorage(STORAGE_KEY_ADMIN_UNLOCKED, false);
      try {
        const url = new URL(window.location.href);
        if (url.searchParams.has('admin')) {
          url.searchParams.delete('admin');
          window.history.replaceState({}, '', url.toString());
        }
      } catch (_err) {
        // Ignore history restriction
      }
      updateAdminUi();
      renderEvents();
      if (appState.activeTab === 'stats') renderStats();
      showToast('已切換回一般訪客瀏覽模式');
    }

    function exportStandaloneHtml() {
      try {
        const mergedEvents = getAllEvents();
        const docClone = document.documentElement.cloneNode(true);

        ['edit-modal', 'add-modal', 'account-modal', 'admin-modal'].forEach(id => {
          const el = docClone.querySelector(`#${id}`);
          if (el) {
            el.classList.add('hidden');
            el.classList.remove('flex');
          }
        });
        const addBtn = docClone.querySelector('#header-add-event-btn');
        if (addBtn) {
          addBtn.classList.add('hidden');
          addBtn.classList.remove('flex');
        }
        const banner = docClone.querySelector('#admin-banner');
        if (banner) banner.classList.add('hidden');

        const seedScript = docClone.querySelector('#builtin-events-seed');
        if (seedScript) {
          seedScript.textContent = JSON.stringify(mergedEvents).replace(/<\//g, '<\\/');
        }

        const htmlString = '<!DOCTYPE html>\n' + docClone.outerHTML;
        const blob = new Blob([htmlString], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'index.html';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        showToast('已匯出最新版 index.html（可直接上傳覆蓋網站）');
      } catch (_err) {
        showToast('匯出 HTML 失敗，請稍後再試');
      }
    }

    function persistState(shouldSyncCloud = true, syncScope = 'all') {
      safeWriteStorage(STORAGE_KEY_ATTENDED, [...appState.attendedIds]);
      safeWriteStorage(STORAGE_KEY_CUSTOM, appState.customEvents);
      safeWriteStorage(STORAGE_KEY_OVERRIDES, appState.eventOverrides);
      safeWriteStorage(STORAGE_KEY_EXTRA_UNPLAYED, appState.extraUnplayedSongs);
      safeWriteStorage(STORAGE_KEY_HIDDEN_UNPLAYED, [...appState.hiddenUnplayedKeys]);
      if (shouldSyncCloud) {
        touchLocalMeta(syncScope);
      }
      if (shouldSyncCloud && typeof window.__onLocalStateMutated === 'function') {
        window.__onLocalStateMutated(syncScope);
      }
    }

    function getAllEvents() {
      const overriddenBuiltins = BUILTIN_EVENTS.map(ev => {
        const patch = appState.eventOverrides[ev.id];
        if (!patch || typeof patch !== 'object') {
          return { ...ev, bgImage: typeof ev.bgImage === 'string' ? ev.bgImage : '' };
        }
        return {
          ...ev,
          ...patch,
          setlist: Array.isArray(patch.setlist) ? patch.setlist : ev.setlist,
          bgImage: typeof patch.bgImage === 'string' ? patch.bgImage : (typeof ev.bgImage === 'string' ? ev.bgImage : '')
        };
      });

      const combined = [...appState.customEvents, ...overriddenBuiltins];
      return combined.sort((a, b) => {
        const da = String(a.date || '');
        const db = String(b.date || '');
        if (da !== db) return da.localeCompare(db);
        return String(a.id || '').localeCompare(String(b.id || ''));
      });
    }

    function escapeHtml(text) {
      return String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function showToast(message) {
      const toast = document.getElementById('toast');
      const msg = document.getElementById('toast-msg');
      if (!toast || !msg) return;
      msg.textContent = message;
      toast.classList.remove('opacity-0');
      toast.classList.add('opacity-100');
      clearTimeout(window.__toastTimer);
      window.__toastTimer = setTimeout(() => {
        toast.classList.remove('opacity-100');
        toast.classList.add('opacity-0');
      }, 2200);
    }

    function compressImageFileToDataUrl(file, maxDimension = 1280, quality = 0.75) {
      return new Promise((resolve, reject) => {
        if (!file || !file.type || !file.type.startsWith('image/')) {
          reject(new Error('請選擇有效的圖片檔案'));
          return;
        }

        const reader = new FileReader();
        reader.onerror = () => reject(new Error('讀取圖片失敗'));
        reader.onload = (ev) => {
          const img = new Image();
          img.onerror = () => reject(new Error('無法解析圖片內容'));
          img.onload = () => {
            try {
              let width = img.naturalWidth || img.width;
              let height = img.naturalHeight || img.height;

              if (width > maxDimension || height > maxDimension) {
                if (width >= height) {
                  height = Math.round((height * maxDimension) / width);
                  width = maxDimension;
                } else {
                  width = Math.round((width * maxDimension) / height);
                  height = maxDimension;
                }
              }

              const canvas = document.createElement('canvas');
              canvas.width = Math.max(1, width);
              canvas.height = Math.max(1, height);
              const ctx = canvas.getContext('2d');
              if (!ctx) {
                reject(new Error('無法建立畫布處理圖片'));
                return;
              }

              ctx.fillStyle = '#FFFDFE';
              ctx.fillRect(0, 0, canvas.width, canvas.height);
              ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

              const dataUrl = canvas.toDataURL('image/jpeg', quality);
              const approxKb = Math.round((dataUrl.length * 3) / 4 / 1024);
              resolve({
                dataUrl,
                width: canvas.width,
                height: canvas.height,
                approxKb
              });
            } catch (err) {
              reject(err);
            }
          };
          img.src = String(ev.target?.result || '');
        };
        reader.readAsDataURL(file);
      });
    }

    function updateBgImagePreviewUi(mode) {
      const prefix = mode === 'edit' ? 'edit' : 'custom';
      const dataUrl = appState.draftBgImages[prefix] || '';
      const previewWrap = document.getElementById(`${prefix}-bg-preview-wrap`);
      const previewImg = document.getElementById(`${prefix}-bg-preview-img`);
      const clearBtn = document.getElementById(`${prefix}-clear-bg-btn`);
      const statusEl = document.getElementById(`${prefix}-bg-status`);

      if (previewWrap && previewImg) {
        if (dataUrl) {
          previewImg.src = dataUrl;
          previewWrap.classList.remove('hidden');
        } else {
          previewImg.src = '';
          previewWrap.classList.add('hidden');
        }
      }

      if (clearBtn) {
        clearBtn.classList.toggle('hidden', !dataUrl);
      }

      if (statusEl && !dataUrl) {
        statusEl.textContent = prefix === 'edit'
          ? '尚未設定背景照片。上傳後會自動縮放壓縮並於歌單面板中淡化顯示。'
          : '可上傳會場照、票券或紀念照片，展開歌單時將以低透明度柔化顯示，不影響曲目辨識。';
      }
    }

    async function handleBgImageUpload(event, mode) {
      const prefix = mode === 'edit' ? 'edit' : 'custom';
      const file = event && event.target && event.target.files && event.target.files[0];
      const statusEl = document.getElementById(`${prefix}-bg-status`);
      if (!file) return;

      try {
        if (statusEl) statusEl.textContent = '正在處理與壓縮圖片...';
        const result = await compressImageFileToDataUrl(file, 1280, 0.75);
        appState.draftBgImages[prefix] = result.dataUrl;
        updateBgImagePreviewUi(prefix);
        if (statusEl) {
          statusEl.textContent = `已載入背景照片（${result.width}×${result.height}，約 ${result.approxKb} KB），展開歌單時將自動淡化。`;
        }
        showToast('已設定歌單背景照片');
      } catch (err) {
        if (statusEl) {
          statusEl.textContent = err && err.message ? err.message : '圖片處理失敗，請換一張照片再試。';
        }
        showToast(err && err.message ? err.message : '圖片處理失敗');
      } finally {
        event.target.value = '';
      }
    }

    function clearDraftBgImage(mode) {
      const prefix = mode === 'edit' ? 'edit' : 'custom';
      appState.draftBgImages[prefix] = '';
      const inputEl = document.getElementById(`${prefix}-bg-image-input`);
      if (inputEl) inputEl.value = '';
      updateBgImagePreviewUi(prefix);
      showToast('已移除歌單背景照片');
    }

    function switchTab(tab) {
      appState.activeTab = tab;
      const panelEvents = document.getElementById('panel-events');
      const panelStats = document.getElementById('panel-stats');
      const tabEvents = document.getElementById('tab-events');
      const tabStats = document.getElementById('tab-stats');

      if (tab === 'stats') {
        panelEvents.classList.add('hidden');
        panelStats.classList.remove('hidden');
        tabStats.className = 'py-2 px-3 rounded-lg text-xs sm:text-sm font-extrabold bg-white text-[#2D1E24] border border-[#F6DCE4] shadow-2xs transition flex items-center justify-center gap-1.5 cursor-pointer';
        tabEvents.className = 'py-2 px-3 rounded-lg text-xs sm:text-sm font-bold text-[#6E535C] hover:text-[#2D1E24] transition flex items-center justify-center gap-1.5 cursor-pointer';
        tabStats.setAttribute('aria-selected', 'true');
        tabEvents.setAttribute('aria-selected', 'false');
        renderStats();
      } else {
        panelStats.classList.add('hidden');
        panelEvents.classList.remove('hidden');
        tabEvents.className = 'py-2 px-3 rounded-lg text-xs sm:text-sm font-extrabold bg-white text-[#2D1E24] border border-[#F6DCE4] shadow-2xs transition flex items-center justify-center gap-1.5 cursor-pointer';
        tabStats.className = 'py-2 px-3 rounded-lg text-xs sm:text-sm font-bold text-[#6E535C] hover:text-[#2D1E24] transition flex items-center justify-center gap-1.5 cursor-pointer';
        tabEvents.setAttribute('aria-selected', 'true');
        tabStats.setAttribute('aria-selected', 'false');
        renderEvents();
      }
    }

    function updateAttendedBadge() {
      const badge = document.getElementById('attended-badge');
      if (badge) badge.textContent = String(appState.attendedIds.size);
    }

    // 年份清單：至少涵蓋 2020–2026，並自動納入資料裡出現的更新年份（例如 2027），之後新增年份不用再改程式
    function getKnownYears() {
      const years = new Set(['2020', '2021', '2022', '2023', '2024', '2025', '2026']);
      for (const ev of getAllEvents()) {
        const y = String((ev && ev.year) || '').trim();
        if (/^20\d{2}$/.test(y)) years.add(y);
      }
      return [...years].sort();
    }

    function renderFilters() {
      const years = ['ALL', ...getKnownYears()];
      const yearPills = document.getElementById('year-pills');
      if (yearPills) {
        yearPills.innerHTML = years.map(y => {
          const active = appState.year === y;
          const label = y === 'ALL' ? '全部年份' : `${y}`;
          return `
            <button
              type="button"
              onclick="selectYear('${y}')"
              class="px-3 py-1.5 rounded-full text-xs font-extrabold whitespace-nowrap transition cursor-pointer ${
                active
                  ? 'bg-[#F19DB5] text-white'
                  : 'bg-white text-[#6E535C] hover:text-[#2D1E24] border border-[#F6DCE4]'
              }"
            >${label}</button>
          `;
        }).join('');
      }

      const categories = [
        { id: 'ALL', label: '全部類型' },
        { id: 'solo', label: '單獨演唱會' },
        { id: 'festival', label: '音樂祭' }
      ];
      const catPills = document.getElementById('category-pills');
      if (catPills) {
        catPills.innerHTML = categories.map(c => {
          const active = appState.category === c.id;
          return `
            <button
              type="button"
              onclick="selectCategory('${c.id}')"
              class="px-3 py-1.5 rounded-xl text-xs font-extrabold whitespace-nowrap transition cursor-pointer ${
                active
                  ? 'bg-[#F19DB5] text-white'
                  : 'bg-white text-[#6E535C] hover:text-[#2D1E24] border border-[#F6DCE4]'
              }"
            >${c.label}</button>
          `;
        }).join('');
      }

      const allEvents = getAllEvents();
      const seriesList = [...new Set(
        allEvents
          .filter(ev => (appState.year === 'ALL' || ev.year === appState.year) && (appState.category === 'ALL' || ev.category === appState.category))
          .map(ev => ev.tourGroup)
          .filter(Boolean)
      )];

      if (!seriesList.includes(appState.series)) {
        appState.series = 'ALL';
      }

      const seriesSelect = document.getElementById('series-select');
      if (seriesSelect) {
        const opts = [`<option value="ALL">全部巡演 / 系列（${seriesList.length}）</option>`];
        for (const s of seriesList) {
          opts.push(`<option value="${escapeHtml(s)}" ${appState.series === s ? 'selected' : ''}>${escapeHtml(s)}</option>`);
        }
        seriesSelect.innerHTML = opts.join('');
      }

      const onlyBtn = document.getElementById('attended-only-btn');
      const onlyDot = document.getElementById('attended-only-indicator');
      if (onlyBtn && onlyDot) {
        if (appState.attendedOnly) {
          onlyBtn.className = 'px-3 py-1.5 rounded-xl text-xs font-extrabold border transition flex items-center gap-2 cursor-pointer bg-[#F19DB5] text-white border-[#F19DB5]';
          onlyDot.className = 'w-2.5 h-2.5 rounded-full bg-white';
        } else {
          onlyBtn.className = 'px-3 py-1.5 rounded-xl text-xs font-extrabold border transition flex items-center gap-2 cursor-pointer bg-white text-[#6E535C] border-[#F6DCE4]';
          onlyDot.className = 'w-2.5 h-2.5 rounded-full bg-[#F6DCE4]';
        }
      }
    }

    function selectYear(y) {
      appState.year = y;
      renderFilters();
      renderEvents();
    }

    function selectCategory(cat) {
      appState.category = cat;
      renderFilters();
      renderEvents();
    }

    function onSeriesChange(val) {
      appState.series = val;
      renderEvents();
    }

    function toggleAttendedOnly() {
      appState.attendedOnly = !appState.attendedOnly;
      renderFilters();
      renderEvents();
    }

    function clearSearch() {
      const input = document.getElementById('search-input');
      if (input) input.value = '';
      renderEvents();
    }

    function toggleAccordion(eventId) {
      if (appState.expandedIds.has(eventId)) {
        appState.expandedIds.delete(eventId);
      } else {
        appState.expandedIds.add(eventId);
      }
      renderEvents();
    }

    function toggleAttendance(e, eventId) {
      e.stopPropagation();
      const idStr = String(eventId);
      if (appState.attendedIds.has(idStr)) {
        appState.attendedIds.delete(idStr);
        showToast('已移除參戰紀錄');
      } else {
        appState.attendedIds.add(idStr);
        showToast('已加入「已參戰」');
      }
      persistState(true, 'attendance');
      updateAttendedBadge();
      if (appState.activeTab === 'stats') {
        renderStats();
      } else {
        renderEvents();
      }
    }

    function deleteCustomEvent(e, eventId) {
      e.stopPropagation();
      appState.customEvents = appState.customEvents.filter(ev => ev.id !== eventId);
      appState.attendedIds.delete(String(eventId));
      appState.expandedIds.delete(String(eventId));
      persistState(true, 'all');
      updateAttendedBadge();
      renderFilters();
      renderEvents();
      showToast('已刪除自訂場次');
    }

    function renderEvents() {
      const searchInput = document.getElementById('search-input');
      const clearBtn = document.getElementById('clear-search-btn');
      const query = String(searchInput ? searchInput.value : '').trim().toLowerCase();

      if (clearBtn) {
        clearBtn.classList.toggle('hidden', query.length === 0);
      }

      const allEvents = getAllEvents();
      const filtered = allEvents.filter(ev => {
        if (appState.year !== 'ALL' && ev.year !== appState.year) return false;
        if (appState.category !== 'ALL') {
          const normalizedCat = ev.category === 'backs' ? 'solo' : ev.category;
          if (normalizedCat !== appState.category) return false;
        }
        if (appState.series !== 'ALL' && ev.tourGroup !== appState.series) return false;
        if (appState.attendedOnly && !appState.attendedIds.has(String(ev.id))) return false;

        if (query) {
          const titleMatch = String(ev.title || '').toLowerCase().includes(query);
          const venueMatch = String(ev.venue || '').toLowerCase().includes(query);
          const tourMatch = String(ev.tourGroup || '').toLowerCase().includes(query);
          const dateMatch = String(ev.date || '').toLowerCase().includes(query);
          const songMatch = Array.isArray(ev.setlist) && ev.setlist.some(s => String(s.title || '').toLowerCase().includes(query));
          if (!titleMatch && !venueMatch && !tourMatch && !dateMatch && !songMatch) return false;
        }
        return true;
      });

      const countEl = document.getElementById('events-count');
      if (countEl) countEl.textContent = String(filtered.length);

      const listEl = document.getElementById('events-list');
      if (!listEl) return;

      if (filtered.length === 0) {
        listEl.innerHTML = `
          <div class="bg-[#FFF5F8] rounded-2xl p-8 border border-[#F6DCE4] text-center space-y-2">
            <div class="text-sm font-black text-[#2D1E24]">找不到符合條件的公演場次</div>
            <p class="text-xs text-[#6E535C]">試著調整年份、類型篩選或清除搜尋關鍵字。</p>
          </div>
        `;
        return;
      }

      listEl.innerHTML = filtered.map(ev => {
        const isAttended = appState.attendedIds.has(String(ev.id));
        const hasMatchingSong = Boolean(query) && Array.isArray(ev.setlist) && ev.setlist.some(s => String(s.title || '').toLowerCase().includes(query));
        const isOpen = appState.expandedIds.has(String(ev.id)) || hasMatchingSong;
        const isCustom = appState.customEvents.some(c => c.id === ev.id);
        const hasBgImage = typeof ev.bgImage === 'string' && ev.bgImage.length > 0;

        const songRows = (ev.setlist || []).map(song => {
          const songTitle = String(song.title || '');
          const isMatched = Boolean(query) && songTitle.toLowerCase().includes(query);
          const isSpecialOrder = song.order === 'OV' || String(song.order || '').startsWith('EN') || String(song.order || '').startsWith('WEN');

          return `
            <div class="flex items-center justify-between gap-3 px-2 py-2 border-b border-[#2D1E24]/15 last:border-b-0 text-xs sm:text-sm ${
              isMatched
                ? 'font-black text-[#C96A88] setlist-text-shadow'
                : 'font-bold text-[#2D1E24] setlist-text-shadow'
            }">
              <div class="flex items-center gap-2.5 min-w-0">
                <span class="min-w-[2.4rem] px-1.5 py-0.5 rounded-md text-center text-[11px] font-black shrink-0 ${
                  isSpecialOrder
                    ? 'bg-[#F19DB5]/90 text-white'
                    : 'text-[#C96A88] setlist-text-shadow'
                }">${escapeHtml(song.order)}</span>
                <span class="truncate">${escapeHtml(songTitle)}</span>
              </div>
            </div>
          `;
        }).join('');

        return `
          <article class="bg-[#FFF5F8] rounded-2xl border ${isAttended ? 'border-[#F19DB5]' : 'border-[#F6DCE4]'} overflow-hidden transition">
            <div
              role="button"
              tabindex="0"
              aria-expanded="${isOpen}"
              onclick="toggleAccordion('${escapeHtml(ev.id)}')"
              onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleAccordion('${escapeHtml(ev.id)}');}"
              class="p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer hover:bg-[#FDE7EE]/55 transition"
            >
              <div class="space-y-1 min-w-0">
                <div class="flex flex-wrap items-center gap-1.5 text-[11px] font-extrabold">
                  <span class="px-2 py-0.5 rounded-md bg-white text-[#2D1E24] border border-[#F6DCE4]">${escapeHtml(ev.date)}</span>
                  <span class="text-[#6E535C] truncate">${escapeHtml(ev.venue || '')}</span>
                </div>
                <h2 class="text-sm sm:text-base font-black text-[#2D1E24] leading-snug">
                  ${escapeHtml(ev.title)}
                </h2>
              </div>

              <div class="flex items-center justify-between sm:justify-end gap-2 shrink-0">
                ${appState.isAdmin ? `
                  <button
                    type="button"
                    onclick="openEditModal(event, '${escapeHtml(ev.id)}')"
                    class="px-2.5 py-1.5 rounded-xl text-xs font-bold bg-white hover:bg-[#FDE7EE] text-[#2D1E24] border border-[#F6DCE4] cursor-pointer"
                  >
                    編輯歌單
                  </button>

                  ${isCustom ? `
                    <button
                      type="button"
                      onclick="deleteCustomEvent(event, '${escapeHtml(ev.id)}')"
                      class="px-2.5 py-1.5 rounded-xl text-xs font-bold bg-white hover:bg-rose-50 text-[#C96A88] border border-[#F6DCE4] cursor-pointer"
                    >
                      刪除
                    </button>
                  ` : ''}
                ` : ''}

                <button
                  type="button"
                  onclick="toggleAttendance(event, '${escapeHtml(ev.id)}')"
                  class="px-3 py-1.5 rounded-xl text-xs font-extrabold transition cursor-pointer ${
                    isAttended
                      ? 'bg-[#F19DB5] text-white'
                      : 'bg-white hover:bg-[#FDE7EE] text-[#2D1E24] border border-[#F6DCE4]'
                  }"
                >
                  ${isAttended ? '✓ 已參戰' : '+ 加入參戰'}
                </button>

                <span class="w-7 h-7 rounded-xl bg-white border border-[#F6DCE4] flex items-center justify-center text-xs font-black text-[#6E535C] select-none">
                  ${isOpen ? '▲' : '▼'}
                </span>
              </div>
            </div>

            <div class="accordion-panel ${isOpen ? 'is-open' : ''}">
              <div class="accordion-inner relative border-t border-[#F6DCE4] bg-[#FFFDFE]/75">
                ${hasBgImage ? `
                  <img
                    src="${escapeHtml(ev.bgImage)}"
                    alt=""
                    aria-hidden="true"
                    class="setlist-bg-photo pointer-events-none select-none absolute inset-0 w-full h-full object-cover z-0"
                  />
                  <div
                    aria-hidden="true"
                    class="pointer-events-none absolute inset-0 z-0 bg-gradient-to-b from-[#FFFDFE]/45 via-[#FFF5F8]/32 to-[#FFFDFE]/55"
                  ></div>
                ` : ''}
                <div class="relative z-10 p-3.5 sm:p-4 space-y-1">
                  <div class="flex items-center justify-between gap-2 text-[11px] font-extrabold text-[#2D1E24] setlist-text-shadow mb-2 pb-1.5 border-b border-[#2D1E24]/15">
                    <span>歌單曲目（共 ${(ev.setlist || []).length} 項）</span>
                    <span class="text-[#6E535C] truncate">${escapeHtml(ev.tourGroup || '')}</span>
                  </div>
                  ${songRows}
                </div>
              </div>
            </div>
          </article>
        `;
      }).join('');
    }

    function computeAttendanceStats() {
      const allEvents = getAllEvents();
      const attendedEvents = allEvents.filter(ev => appState.attendedIds.has(String(ev.id)));
      const attendedCount = attendedEvents.length;

      let soloCount = 0;
      let festivalCount = 0;
      for (const ev of attendedEvents) {
        if (ev.category === 'solo' || ev.category === 'backs') soloCount += 1;
        else festivalCount += 1;
      }

      const catalogMap = new Map();
      for (const title of SAKURAZAKA46_FULL_SONGS) {
        const cleanTitle = String(title || '').trim();
        if (!cleanTitle) continue;
        const normKey = normalizeSongKey(cleanTitle);
        if (!catalogMap.has(normKey)) {
          catalogMap.set(normKey, cleanTitle);
        }
      }
      for (const title of appState.extraUnplayedSongs) {
        const cleanTitle = String(title || '').trim();
        if (!cleanTitle) continue;
        const normKey = normalizeSongKey(cleanTitle);
        if (!catalogMap.has(normKey)) {
          catalogMap.set(normKey, cleanTitle);
        }
      }

      const songCounts = new Map();
      const heardNormKeys = new Set();
      let totalPlays = 0;

      for (const ev of attendedEvents) {
        for (const item of (ev.setlist || [])) {
          if (item.section === 'overture') continue;
          const rawTitle = String(item.title || '').trim();
          if (!rawTitle) continue;
          const normKey = normalizeSongKey(rawTitle);
          const canonicalTitle = catalogMap.get(normKey) || rawTitle;
          totalPlays += 1;
          heardNormKeys.add(normKey);
          songCounts.set(canonicalTitle, (songCounts.get(canonicalTitle) || 0) + 1);
        }
      }

      const unplayedSongs = [...catalogMap.entries()]
        .filter(([normKey]) => !heardNormKeys.has(normKey) && !appState.hiddenUnplayedKeys.has(normKey))
        .map(([, canonicalTitle]) => canonicalTitle);

      const catalogHeardCount = [...heardNormKeys].filter(normKey => catalogMap.has(normKey) && !appState.hiddenUnplayedKeys.has(normKey)).length;
      const visibleCatalogTotal = catalogHeardCount + unplayedSongs.length;
      const uniqueHeard = catalogHeardCount;
      const completionPct = visibleCatalogTotal > 0 ? Math.round((uniqueHeard / visibleCatalogTotal) * 100) : 0;

      const rankedSongs = [...songCounts.entries()].map(([title, count]) => ({
        title,
        count,
        ratioPct: attendedCount > 0 ? Math.round((count / attendedCount) * 100) : 0
      }));

      rankedSongs.sort((a, b) => {
        if (appState.songSortMode === 'pct') {
          if (b.ratioPct !== a.ratioPct) return b.ratioPct - a.ratioPct;
          if (b.count !== a.count) return b.count - a.count;
        } else {
          if (b.count !== a.count) return b.count - a.count;
          if (b.ratioPct !== a.ratioPct) return b.ratioPct - a.ratioPct;
        }
        return a.title.localeCompare(b.title, 'zh-Hant');
      });

      const yearlyCounts = {};
      for (const y of getKnownYears()) {
        yearlyCounts[y] = 0;
      }
      for (const ev of attendedEvents) {
        const y = String(ev.year || '');
        if (Object.prototype.hasOwnProperty.call(yearlyCounts, y)) {
          yearlyCounts[y] += 1;
        }
      }

      return {
        attendedCount,
        soloCount,
        festivalCount,
        totalPlays,
        uniqueHeard,
        totalCatalog: visibleCatalogTotal,
        completionPct,
        rankedSongs,
        unplayedSongs,
        yearlyCounts
      };
    }

    function addUnplayedSong(e) {
      if (e) e.preventDefault();
      if (!appState.isAdmin) {
        showToast('請先解鎖管理模式才能新增曲目');
        openAdminModal();
        return;
      }
      const input = document.getElementById('unplayed-song-input');
      const title = String(input?.value || '').trim();
      if (!title) {
        showToast('請輸入曲目名稱');
        return;
      }

      const normKey = normalizeSongKey(title);
      const stats = computeAttendanceStats();
      const alreadyUnplayed = stats.unplayedSongs.some(s => normalizeSongKey(s) === normKey);

      if (alreadyUnplayed) {
        showToast('此曲目已在未聽清單中');
        return;
      }

      if (appState.hiddenUnplayedKeys.has(normKey)) {
        appState.hiddenUnplayedKeys.delete(normKey);
      }

      const alreadyInExtra = appState.extraUnplayedSongs.some(s => normalizeSongKey(s) === normKey);
      const alreadyInBuiltIn = SAKURAZAKA46_FULL_SONGS.some(s => normalizeSongKey(s) === normKey);
      if (!alreadyInExtra && !alreadyInBuiltIn) {
        appState.extraUnplayedSongs.unshift(title);
      }

      if (input) input.value = '';
      persistState(true, 'attendance');
      renderStats();
      showToast(`已新增「${title}」至未聽曲目清單`);
    }

    function removeUnplayedSong(songTitle) {
      if (!appState.isAdmin) {
        showToast('請先解鎖管理模式才能刪除曲目');
        openAdminModal();
        return;
      }
      const normKey = normalizeSongKey(songTitle);
      appState.extraUnplayedSongs = appState.extraUnplayedSongs.filter(s => normalizeSongKey(s) !== normKey);
      appState.hiddenUnplayedKeys.add(normKey);
      persistState(true, 'attendance');
      renderStats();
      showToast(`已移除「${songTitle}」`);
    }

    function setSongSortMode(mode) {
      appState.songSortMode = mode;
      const btnCount = document.getElementById('sort-by-count');
      const btnPct = document.getElementById('sort-by-pct');
      if (btnCount && btnPct) {
        if (mode === 'pct') {
          btnPct.className = 'px-2.5 py-1 rounded-lg bg-[#F19DB5] text-white cursor-pointer';
          btnCount.className = 'px-2.5 py-1 rounded-lg text-[#6E535C] hover:text-[#2D1E24] cursor-pointer';
        } else {
          btnCount.className = 'px-2.5 py-1 rounded-lg bg-[#F19DB5] text-white cursor-pointer';
          btnPct.className = 'px-2.5 py-1 rounded-lg text-[#6E535C] hover:text-[#2D1E24] cursor-pointer';
        }
      }
      renderStats();
    }

    function toggleShowAllRanking() {
      appState.showAllRanking = !appState.showAllRanking;
      renderStats();
    }

    function toggleShowAllUnplayed() {
      appState.showAllUnplayed = !appState.showAllUnplayed;
      renderStats();
    }

    function renderStats() {
      const stats = computeAttendanceStats();

      const elAttended = document.getElementById('kpi-attended-events');
      const elBreakdown = document.getElementById('kpi-event-breakdown');
      const elPlays = document.getElementById('kpi-total-plays');
      const elUnique = document.getElementById('kpi-unique-songs');
      const elTotalSongs = document.getElementById('kpi-total-songs');
      const elBar = document.getElementById('kpi-completion-bar');
      const elPct = document.getElementById('kpi-completion-pct');
      const elTopSong = document.getElementById('kpi-top-song');
      const elTopMeta = document.getElementById('kpi-top-song-meta');

      if (elAttended) elAttended.textContent = String(stats.attendedCount);
      if (elBreakdown) {
        elBreakdown.textContent = `單獨 ${stats.soloCount} / 音樂祭 ${stats.festivalCount}`;
      }
      if (elPlays) elPlays.textContent = String(stats.totalPlays);
      if (elUnique) elUnique.textContent = String(stats.uniqueHeard);
      if (elTotalSongs) elTotalSongs.textContent = `/ ${stats.totalCatalog} 首`;
      if (elBar) elBar.style.width = `${stats.completionPct}%`;
      if (elPct) elPct.textContent = `解鎖比例 ${stats.completionPct}%`;

      if (stats.rankedSongs.length > 0 && elTopSong && elTopMeta) {
        const top = stats.rankedSongs[0];
        elTopSong.textContent = top.title;
        elTopMeta.textContent = `${top.count} 次（參戰場次出現率 ${top.ratioPct}%）`;
      } else if (elTopSong && elTopMeta) {
        elTopSong.textContent = '尚未加入參戰場次';
        elTopMeta.textContent = '—';
      }

      const yearlyChartEl = document.getElementById('yearly-chart');
      if (yearlyChartEl) {
        const years = Object.keys(stats.yearlyCounts);
        const maxVal = Math.max(1, ...years.map(y => stats.yearlyCounts[y]));
        yearlyChartEl.innerHTML = years.map(y => {
          const val = stats.yearlyCounts[y];
          const widthPct = Math.round((val / maxVal) * 100);
          return `
            <div class="flex items-center gap-3 text-xs">
              <span class="w-11 font-extrabold text-[#2D1E24] shrink-0">${y}</span>
              <div class="flex-1 h-5 bg-white rounded-lg border border-[#F6DCE4] overflow-hidden">
                <div class="h-full bg-[#F19DB5] transition-all duration-300" style="width: ${widthPct}%"></div>
              </div>
              <span class="w-10 text-right font-black text-[#2D1E24] shrink-0">${val} 場</span>
            </div>
          `;
        }).join('');
      }

      const rankSearchInput = document.getElementById('ranking-search');
      const rankQuery = String(rankSearchInput ? rankSearchInput.value : '').trim().toLowerCase();
      const filteredRanked = rankQuery
        ? stats.rankedSongs.filter(s => s.title.toLowerCase().includes(rankQuery))
        : stats.rankedSongs;

      const rankingListEl = document.getElementById('song-ranking-list');
      const toggleWrap = document.getElementById('ranking-toggle-wrap');
      const toggleBtn = document.getElementById('ranking-toggle-btn');

      if (rankingListEl) {
        if (filteredRanked.length === 0) {
          rankingListEl.innerHTML = `
            <div class="bg-white rounded-xl p-6 border border-[#F6DCE4] text-center text-xs text-[#6E535C]">
              ${stats.attendedCount === 0
                ? '還沒有參戰場次喔！先到「歷年場次與歌單」點選「+ 加入參戰」，就能看到現場聽過的歌曲統計與比例。'
                : '找不到符合搜尋條件的歌曲。'}
            </div>
          `;
          if (toggleWrap) toggleWrap.classList.add('hidden');
        } else {
          const limit = appState.showAllRanking || rankQuery ? filteredRanked.length : Math.min(5, filteredRanked.length);
          const visibleItems = filteredRanked.slice(0, limit);
          const maxCount = Math.max(1, ...filteredRanked.map(s => s.count));

          rankingListEl.innerHTML = visibleItems.map((item, idx) => {
            const barWidth = Math.max(4, Math.round((item.count / maxCount) * 100));
            return `
              <div class="bg-white rounded-xl p-2.5 sm:p-3 border border-[#F6DCE4] space-y-1.5">
                <div class="flex items-center justify-between gap-2 text-xs sm:text-sm">
                  <div class="flex items-center gap-2 min-w-0">
                    <span class="w-6 h-6 rounded-lg bg-[#FFF5F8] border border-[#F6DCE4] text-[11px] font-black text-[#C96A88] flex items-center justify-center shrink-0">
                      ${idx + 1}
                    </span>
                    <span class="font-extrabold text-[#2D1E24] truncate">${escapeHtml(item.title)}</span>
                  </div>
                  <div class="text-right shrink-0 text-xs font-black text-[#2D1E24]">
                    <span>${item.count} 次</span>
                    <span class="ml-1.5 px-2 py-0.5 rounded-full bg-[#FFF5F8] text-[#C96A88] border border-[#F6DCE4]">${item.ratioPct}%</span>
                  </div>
                </div>
                <div class="w-full h-1.5 bg-[#FFF5F8] rounded-full overflow-hidden">
                  <div class="h-full bg-[#F19DB5]" style="width: ${barWidth}%"></div>
                </div>
              </div>
            `;
          }).join('');

          if (toggleWrap && toggleBtn) {
            if (!rankQuery && filteredRanked.length > 5) {
              toggleWrap.classList.remove('hidden');
              toggleBtn.textContent = appState.showAllRanking
                ? '收回為前 5 首'
                : `展開全部歌曲（共 ${filteredRanked.length} 首）`;
            } else {
              toggleWrap.classList.add('hidden');
            }
          }
        }
      }

      const unplayedCountEl = document.getElementById('unplayed-count');
      const unplayedListEl = document.getElementById('unplayed-songs-list');
      const unplayedToggleWrap = document.getElementById('unplayed-toggle-wrap');
      const unplayedToggleBtn = document.getElementById('unplayed-toggle-btn');

      if (unplayedCountEl) unplayedCountEl.textContent = `${stats.unplayedSongs.length} 首`;
      if (unplayedListEl) {
        if (stats.unplayedSongs.length === 0) {
          unplayedListEl.innerHTML = `<span class="text-xs font-bold text-[#C96A88]">${
            appState.isAdmin
              ? '目前清單內沒有未聽曲目，你也可以在上方輸入想新增的歌曲！'
              : '目前清單內沒有未聽曲目。'
          }</span>`;
          if (unplayedToggleWrap) unplayedToggleWrap.classList.add('hidden');
        } else {
          const unplayedLimit = appState.showAllUnplayed ? stats.unplayedSongs.length : Math.min(10, stats.unplayedSongs.length);
          const visibleUnplayed = stats.unplayedSongs.slice(0, unplayedLimit);

          unplayedListEl.innerHTML = visibleUnplayed.map(title => `
            <span class="inline-flex items-center gap-1.5 ${appState.isAdmin ? 'pl-2.5 pr-1.5' : 'px-2.5'} py-1 rounded-lg bg-white text-xs font-semibold text-[#6E535C] border border-[#F6DCE4]">
              <span>${escapeHtml(title)}</span>
              ${appState.isAdmin ? `
                <button
                  type="button"
                  onclick="removeUnplayedSong('${escapeHtml(title).replace(/'/g, '&#39;')}')"
                  class="w-4 h-4 rounded hover:bg-rose-50 hover:text-[#C96A88] text-[#6E535C]/70 flex items-center justify-center text-[10px] font-black cursor-pointer transition"
                  title="移除「${escapeHtml(title)}」"
                  aria-label="移除「${escapeHtml(title)}」"
                >✕</button>
              ` : ''}
            </span>
          `).join('');

          if (unplayedToggleWrap && unplayedToggleBtn) {
            if (stats.unplayedSongs.length > 10) {
              unplayedToggleWrap.classList.remove('hidden');
              unplayedToggleBtn.textContent = appState.showAllUnplayed
                ? '收回為前 10 首'
                : `展開全部未聽曲目（共 ${stats.unplayedSongs.length} 首）`;
            } else {
              unplayedToggleWrap.classList.add('hidden');
            }
          }
        }
      }
    }

    function openAddModal() {
      if (!appState.isAdmin) {
        openAdminModal();
        return;
      }
      const modal = document.getElementById('add-modal');
      const dateInput = document.getElementById('custom-date');
      const yearInput = document.getElementById('custom-year');
      if (dateInput && !dateInput.value) {
        dateInput.value = '2026-04-11';
      }
      syncYearFromDate();
      if (yearInput && !yearInput.value) {
        yearInput.value = '2026';
      }
      updateBgImagePreviewUi('custom');
      if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
      }
    }

    function closeAddModal() {
      const modal = document.getElementById('add-modal');
      if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
      }
    }

    function handleBackdropClick(e) {
      if (e.target && e.target.id === 'add-modal') {
        closeAddModal();
      }
    }

    function syncYearFromDate() {
      const dateInput = document.getElementById('custom-date');
      const yearInput = document.getElementById('custom-year');
      if (dateInput && yearInput && dateInput.value) {
        const y = dateInput.value.slice(0, 4);
        if (/^\d{4}$/.test(y)) {
          yearInput.value = y;
        }
      }
    }

    function parseSetlistText(rawText) {
      const lines = String(rawText || '')
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(Boolean);

      const items = [];
      let mode = 'main';
      let mainIdx = 0;
      let enIdx = 0;
      let wenIdx = 0;

      for (const line of lines) {
        const upper = line.toUpperCase();
        if (upper === 'W-ENCORE' || upper === 'WENCORE' || upper === 'DOUBLE ENCORE') {
          mode = 'wencore';
          continue;
        }
        if (upper === 'ENCORE' || upper === 'EN') {
          mode = 'encore';
          continue;
        }

        // 先檢查是否為 Overture（支援行首有或無序號前綴，例如 "Overture" 或 "OV. Overture"）
        const strippedForOv = line.replace(/^(OV|WEN\d+|EN\d+|\d+)[.、:：\s]+/i, '').trim();
        if (
          upper === 'OVERTURE' ||
          line === 'Overture' ||
          strippedForOv.toUpperCase() === 'OVERTURE'
        ) {
          items.push({ order: 'OV', title: 'Overture', section: 'overture' });
          continue;
        }

        // 支援行首指定自訂序號（可重複，例如 "1. A歌" 與 "1. B歌"）
        const customOrderMatch = line.match(/^(WEN\d+|EN\d+|\d+)[.、:：\s]+(.+)$/i);
        let orderLabel = '';
        let songTitle = line;

        if (customOrderMatch) {
          orderLabel = customOrderMatch[1].toUpperCase();
          songTitle = customOrderMatch[2].trim();
          const num = parseInt(orderLabel.replace(/\D+/g, ''), 10);
          if (!Number.isNaN(num)) {
            if (orderLabel.startsWith('WEN') || mode === 'wencore') {
              wenIdx = Math.max(wenIdx, num);
              mode = 'wencore';
            } else if (orderLabel.startsWith('EN') || mode === 'encore') {
              enIdx = Math.max(enIdx, num);
              mode = 'encore';
            } else {
              mainIdx = Math.max(mainIdx, num);
            }
          }
        } else if (mode === 'wencore') {
          wenIdx += 1;
          orderLabel = `WEN${wenIdx}`;
        } else if (mode === 'encore') {
          enIdx += 1;
          orderLabel = `EN${enIdx}`;
        } else {
          mainIdx += 1;
          orderLabel = String(mainIdx);
        }

        items.push({ order: orderLabel, title: songTitle, section: mode });
      }
      return items;
    }

    function serializeSetlistToText(setlist = []) {
      const lines = [];
      let inEncore = false;
      let inWencore = false;

      for (const item of setlist) {
        if (!item || !item.title) continue;
        if (item.section === 'encore' && !inEncore) {
          lines.push('ENCORE');
          inEncore = true;
        } else if (item.section === 'wencore' && !inWencore) {
          lines.push('W-ENCORE');
          inWencore = true;
        }

        const isOverture =
          item.section === 'overture' ||
          String(item.title).trim().toUpperCase() === 'OVERTURE' ||
          String(item.order || '').trim().toUpperCase() === 'OV';

        if (isOverture) {
          lines.push('Overture');
          continue;
        }

        const prefix = item.order ? `${String(item.order).trim()}. ` : '';
        lines.push(`${prefix}${item.title}`);
      }

      return lines.join('\n');
    }

    function openEditModal(e, eventId) {
      if (e) e.stopPropagation();
      if (!appState.isAdmin) {
        openAdminModal();
        return;
      }
      const target = getAllEvents().find(ev => String(ev.id) === String(eventId));
      if (!target) return;

      const isCustom = appState.customEvents.some(c => c.id === target.id);
      const hasOverride = !isCustom && Boolean(appState.eventOverrides[target.id]);

      document.getElementById('edit-event-id').value = target.id;
      document.getElementById('edit-date').value = target.date || `${target.year || '2026'}-01-01`;
      document.getElementById('edit-year').value = target.year || '2026';
      document.getElementById('edit-category').value = target.category === 'backs' ? 'solo' : (target.category || 'solo');
      document.getElementById('edit-title').value = target.title || '';
      document.getElementById('edit-tour-group').value = target.tourGroup || '';
      document.getElementById('edit-venue').value = target.venue || '';
      document.getElementById('edit-setlist').value = serializeSetlistToText(target.setlist || []);

      appState.draftBgImages.edit = typeof target.bgImage === 'string' ? target.bgImage : '';
      updateBgImagePreviewUi('edit');
      const editStatus = document.getElementById('edit-bg-status');
      if (editStatus && appState.draftBgImages.edit) {
        editStatus.textContent = '目前已設定此場次的歌單背景照片，可重新上傳或按右上角移除。';
      }

      const badge = document.getElementById('edit-badge-type');
      if (badge) {
        badge.textContent = isCustom ? '自訂場次' : (hasOverride ? '已自訂修改' : '內建場次');
      }

      const revertBtn = document.getElementById('revert-builtin-btn');
      if (revertBtn) {
        revertBtn.classList.toggle('hidden', !hasOverride);
      }

      const modal = document.getElementById('edit-modal');
      if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
      }
    }

    function closeEditModal() {
      appState.draftBgImages.edit = '';
      const modal = document.getElementById('edit-modal');
      if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
      }
    }

    function handleEditBackdropClick(e) {
      if (e.target && e.target.id === 'edit-modal') {
        closeEditModal();
      }
    }

    function syncEditYearFromDate() {
      const dateInput = document.getElementById('edit-date');
      const yearInput = document.getElementById('edit-year');
      if (dateInput && yearInput && dateInput.value) {
        const y = dateInput.value.slice(0, 4);
        if (/^\d{4}$/.test(y)) {
          yearInput.value = y;
        }
      }
    }

    function submitEditEvent(e) {
      e.preventDefault();
      const eventId = String(document.getElementById('edit-event-id')?.value || '').trim();
      const dateVal = String(document.getElementById('edit-date')?.value || '').trim();
      const yearVal = String(document.getElementById('edit-year')?.value || '').trim() || dateVal.slice(0, 4) || '2026';
      const categoryVal = String(document.getElementById('edit-category')?.value || 'solo') === 'backs'
        ? 'solo'
        : String(document.getElementById('edit-category')?.value || 'solo');
      const titleVal = String(document.getElementById('edit-title')?.value || '').trim();
      const tourVal = String(document.getElementById('edit-tour-group')?.value || '').trim() || titleVal;
      const venueVal = String(document.getElementById('edit-venue')?.value || '').trim();
      const rawSetlist = String(document.getElementById('edit-setlist')?.value || '');
      const bgImageVal = appState.draftBgImages.edit || '';

      const parsedSetlist = parseSetlistText(rawSetlist);
      if (!eventId || !titleVal || !venueVal || parsedSetlist.length === 0) {
        showToast('請完整填寫場次名稱、會場與至少一首歌曲');
        return;
      }

      const customIdx = appState.customEvents.findIndex(c => c.id === eventId);
      if (customIdx !== -1) {
        appState.customEvents[customIdx] = {
          ...appState.customEvents[customIdx],
          year: yearVal,
          date: dateVal || appState.customEvents[customIdx].date,
          category: categoryVal,
          title: titleVal,
          tourGroup: tourVal,
          venue: venueVal,
          setlist: parsedSetlist,
          bgImage: bgImageVal
        };
      } else {
        appState.eventOverrides[eventId] = {
          year: yearVal,
          date: dateVal,
          category: categoryVal,
          title: titleVal,
          tourGroup: tourVal,
          venue: venueVal,
          setlist: parsedSetlist,
          bgImage: bgImageVal
        };
      }

      appState.expandedIds.add(eventId);
      persistState(true, 'setlist');
      renderFilters();
      renderEvents();
      if (appState.activeTab === 'stats') {
        renderStats();
      }
      closeEditModal();
      showToast('已儲存歌單與場次修改');
    }

    function revertBuiltinOverride() {
      const eventId = String(document.getElementById('edit-event-id')?.value || '').trim();
      if (!eventId || !appState.eventOverrides[eventId]) return;
      delete appState.eventOverrides[eventId];
      persistState(true, 'setlist');
      renderFilters();
      renderEvents();
      if (appState.activeTab === 'stats') {
        renderStats();
      }
      closeEditModal();
      showToast('已還原為預設歌單');
    }

    function submitNewEvent(e) {
      e.preventDefault();
      const dateVal = String(document.getElementById('custom-date')?.value || '').trim();
      const yearVal = String(document.getElementById('custom-year')?.value || '').trim() || dateVal.slice(0, 4) || '2026';
      const rawCat = String(document.getElementById('custom-category')?.value || 'solo');
      const categoryVal = rawCat === 'backs' ? 'solo' : rawCat;
      const titleVal = String(document.getElementById('custom-title')?.value || '').trim();
      const tourVal = String(document.getElementById('custom-tour-group')?.value || '').trim() || titleVal;
      const venueVal = String(document.getElementById('custom-venue')?.value || '').trim();
      const rawSetlist = String(document.getElementById('custom-setlist')?.value || '');
      const markAttended = Boolean(document.getElementById('custom-mark-attended')?.checked);
      const bgImageVal = appState.draftBgImages.custom || '';

      const parsedSetlist = parseSetlistText(rawSetlist);
      if (!titleVal || !venueVal || parsedSetlist.length === 0) {
        showToast('請完整填寫場次名稱、會場與至少一首歌曲');
        return;
      }

      const newId = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const newEvent = {
        id: newId,
        year: yearVal,
        date: dateVal || `${yearVal}-01-01`,
        title: titleVal,
        tourGroup: tourVal,
        category: categoryVal,
        venue: venueVal,
        setlist: parsedSetlist,
        bgImage: bgImageVal
      };

      appState.customEvents.push(newEvent);
      appState.expandedIds.add(newId);
      if (markAttended) {
        appState.attendedIds.add(newId);
      }

      persistState(true, markAttended ? 'all' : 'setlist');
      updateAttendedBadge();
      renderFilters();
      renderEvents();
      if (appState.activeTab === 'stats') {
        renderStats();
      }

      const form = document.getElementById('add-event-form');
      if (form) form.reset();
      appState.draftBgImages.custom = '';
      updateBgImagePreviewUi('custom');
      closeAddModal();
      showToast('已新增自訂場次');
    }

    function exportJsonData() {
      try {
        const payload = {
          app: 'sakurazaka46_setlist',
          version: 4,
          exportedAt: new Date().toISOString(),
          attendedIds: [...appState.attendedIds],
          customEvents: appState.customEvents,
          eventOverrides: appState.eventOverrides,
          extraUnplayedSongs: appState.extraUnplayedSongs,
          hiddenUnplayedKeys: [...appState.hiddenUnplayedKeys]
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `sakurazaka46-attendance-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        showToast('已匯出 JSON 備份檔');
      } catch (_err) {
        showToast('匯出失敗，請稍後再試');
      }
    }

    function importJsonData(event) {
      const file = event && event.target && event.target.files && event.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = function (loadEvt) {
        try {
          const parsed = JSON.parse(String(loadEvt.target?.result || '{}'));
          const importedAttended = Array.isArray(parsed.attendedIds) ? parsed.attendedIds.map(String) : [];
          const importedCustom = Array.isArray(parsed.customEvents)
            ? parsed.customEvents.filter(ev => ev && ev.id && ev.title && Array.isArray(ev.setlist)).map(ev => ({
                ...ev,
                bgImage: typeof ev.bgImage === 'string' ? ev.bgImage : ''
              }))
            : [];
          const importedOverrides = {};
          if (parsed.eventOverrides && typeof parsed.eventOverrides === 'object' && !Array.isArray(parsed.eventOverrides)) {
            for (const [key, val] of Object.entries(parsed.eventOverrides)) {
              if (val && typeof val === 'object') {
                importedOverrides[key] = {
                  ...val,
                  bgImage: typeof val.bgImage === 'string' ? val.bgImage : ''
                };
              }
            }
          }
          const importedExtraUnplayed = Array.isArray(parsed.extraUnplayedSongs)
            ? parsed.extraUnplayedSongs.map(s => String(s || '').trim()).filter(Boolean)
            : [];
          const importedHiddenUnplayed = Array.isArray(parsed.hiddenUnplayedKeys)
            ? parsed.hiddenUnplayedKeys.map(String)
            : [];

          appState.attendedIds = new Set(importedAttended);
          appState.customEvents = importedCustom;
          appState.eventOverrides = importedOverrides;
          appState.extraUnplayedSongs = importedExtraUnplayed;
          appState.hiddenUnplayedKeys = new Set(importedHiddenUnplayed);
          persistState(true, 'all');
          updateAttendedBadge();
          renderFilters();
          renderEvents();
          if (appState.activeTab === 'stats') {
            renderStats();
          }
          showToast(`已匯入 ${importedAttended.length} 場參戰紀錄`);
        } catch (_err) {
          showToast('JSON 格式無效，無法匯入');
        } finally {
          event.target.value = '';
        }
      };
      reader.readAsText(file);
    }

    function resetAllUserData() {
      appState.attendedIds.clear();
      appState.customEvents = [];
      appState.eventOverrides = {};
      appState.extraUnplayedSongs = [];
      appState.hiddenUnplayedKeys.clear();
      persistState(true, 'all');
      updateAttendedBadge();
      renderFilters();
      renderEvents();
      renderStats();
      showToast('已重設所有參戰與自訂紀錄');
    }

    // ---- 分享參戰圖（Canvas 繪圖與預覽互動） ----
    let currentReportDataUrl = '';
    let currentReportBlob = null;
    let nicknameRedrawTimer = null;
    const NICKNAME_STORAGE_KEY = 'sakurazaka_report_nickname';

    function getSavedNickname() {
      return (safeReadStorage(NICKNAME_STORAGE_KEY, '') || '').trim();
    }

    function saveNickname(val) {
      const trimmed = (val || '').trim();
      safeWriteStorage(NICKNAME_STORAGE_KEY, trimmed);
    }

    function onNicknameInputChange(val) {
      saveNickname(val);
      clearTimeout(nicknameRedrawTimer);
      nicknameRedrawTimer = setTimeout(async () => {
        const dataUrl = await generateShareReportCanvas();
        const imgEl = document.getElementById('share-report-preview-img');
        if (imgEl) imgEl.src = dataUrl;
      }, 180);
    }

    function drawRoundRect(ctx, x, y, w, h, r, fillStyle, strokeStyle = null, lineWidth = 2) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
      if (fillStyle) {
        ctx.fillStyle = fillStyle;
        ctx.fill();
      }
      if (strokeStyle) {
        ctx.strokeStyle = strokeStyle;
        ctx.lineWidth = lineWidth;
        ctx.stroke();
      }
    }

    function drawTruncatedText(ctx, text, x, y, maxWidth) {
      let display = String(text || '');
      if (ctx.measureText(display).width > maxWidth) {
        while (display.length > 1 && ctx.measureText(display + '…').width > maxWidth) {
          display = display.slice(0, -1);
        }
        display += '…';
      }
      ctx.fillText(display, x, y);
    }

    async function generateShareReportCanvas() {
      const data = window.getUserReportStats();
      const reportExtraRows = Math.max(0, ((data.yearCounts && data.yearCounts.length) || 7) - 7);
      const reportHeight = 1350 + reportExtraRows * 32;
      const canvas = document.createElement('canvas');
      canvas.width = 1080;
      canvas.height = reportHeight;
      const ctx = canvas.getContext('2d');

      const bgGrad = ctx.createLinearGradient(0, 0, 1080, reportHeight);
      bgGrad.addColorStop(0, '#FFF5F8');
      bgGrad.addColorStop(0.5, '#FCE7EF');
      bgGrad.addColorStop(1, '#F8D7E4');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, 1080, reportHeight);

      ctx.save();
      ctx.fillStyle = 'rgba(236, 72, 153, 0.06)';
      ctx.beginPath();
      ctx.moveTo(780, 0);
      ctx.lineTo(1080, 0);
      ctx.lineTo(1080, 420);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      drawRoundRect(ctx, 56, 52, 968, 138, 28, '#FFFFFF', '#FBCFE8', 2);
      ctx.fillStyle = '#EC4899';
      ctx.beginPath();
      ctx.moveTo(96, 148);
      ctx.lineTo(148, 148);
      ctx.lineTo(148, 94);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#1F2937';
      ctx.font = 'bold 38px "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif';
      ctx.fillText('櫻坂46 歷年參戰履歷', 172, 134);

      ctx.fillStyle = '#6B7280';
      ctx.font = '24px "Noto Sans TC", sans-serif';

      if (data.badgeText) {
        drawRoundRect(ctx, 716, 88, 276, 64, 32, '#FDF2F8', '#F9A8D4', 2);
        ctx.fillStyle = '#BE185D';
        ctx.font = 'bold 24px "Noto Sans TC", sans-serif';
        ctx.textAlign = 'center';
        drawTruncatedText(ctx, data.badgeText, 854, 128, 244);
        ctx.textAlign = 'left';
      }

      const cards = [
        {
          title: '已參戰場次',
          value: `${data.totalLives} 場`,
          sub: data.liveDetail,
          x: 56, y: 214
        },
        {
          title: '現場聽過總曲次',
          value: `${data.totalSongs} 次`,
          sub: '含安可累計演出曲數',
          x: 552, y: 214
        },
        {
          title: '解鎖不重複曲目',
          value: `${data.unlockedCount} / ${data.totalCatalog} 首`,
          sub: `全曲庫解鎖比例 ${data.unlockRate}`,
          x: 56, y: 396
        },
        {
          title: '最常聽到第一名',
          value: data.topSongName,
          sub: data.topSongSub,
          x: 552, y: 396,
          isSong: true
        }
      ];

      cards.forEach(c => {
        drawRoundRect(ctx, c.x, c.y, 472, 162, 24, '#FFFFFF', '#FBCFE8', 2);
        ctx.fillStyle = '#6B7280';
        ctx.font = 'bold 23px "Noto Sans TC", sans-serif';
        ctx.fillText(c.title, c.x + 28, c.y + 44);

        ctx.fillStyle = c.isSong ? '#BE185D' : '#111827';
        ctx.font = c.isSong ? 'bold 34px "Noto Sans TC", sans-serif' : 'bold 46px "Noto Sans TC", sans-serif';
        drawTruncatedText(ctx, c.value, c.x + 28, c.y + 102, 416);

        ctx.fillStyle = '#9CA3AF';
        ctx.font = '21px "Noto Sans TC", sans-serif';
        drawTruncatedText(ctx, c.sub, c.x + 28, c.y + 140, 416);
      });
        
      const yearCardX = 56;
      const yearCardW = 968;
      const yearCardTop = 582;
      const yearTitleY = yearCardTop + 50; // 632
      const listStartY = yearCardTop + 92; // 674
      const rowStep = 32;
      const barHeight = 20;
      const yearCardBottomPad = 24;

      const yearCount = data.yearCounts.length;
      const rowsEndY = listStartY + Math.max(yearCount - 1, 0) * rowStep + barHeight;
      const yearCardHeight = Math.max(326, rowsEndY + yearCardBottomPad - yearCardTop);
      const yearCardBottom = yearCardTop + yearCardHeight;

      const years = data.yearCounts.map(d => d.year);
      const yearRangeLabel = years.length > 1
        ? `（${years[0]}–${years[years.length - 1]}）`
        : years.length === 1
          ? `（${years[0]}）`
          : '';

      drawRoundRect(ctx, yearCardX, yearCardTop, yearCardW, yearCardHeight, 26, '#FFFFFF', '#FBCFE8', 2);
      ctx.fillStyle = '#1F2937';
      ctx.font = 'bold 28px "Noto Sans TC", sans-serif';
      ctx.fillText(`年度參戰分布${yearRangeLabel}`, 88, yearTitleY);

      const maxYearCount = Math.max(...data.yearCounts.map(d => d.count), 1);
      data.yearCounts.forEach((item, idx) => {
        const rowY = listStartY + idx * rowStep;
        ctx.fillStyle = '#374151';
        ctx.font = 'bold 22px "Noto Sans TC", sans-serif';
        ctx.fillText(item.year, 88, rowY + 16);

        const barX = 172;
        const barMaxW = 730;
        drawRoundRect(ctx, barX, rowY, barMaxW, barHeight, 10, '#FCE7F3');

        if (item.count > 0) {
          const fillW = Math.max(24, (item.count / maxYearCount) * barMaxW);
          const barGrad = ctx.createLinearGradient(barX, 0, barX + fillW, 0);
          barGrad.addColorStop(0, '#F472B6');
          barGrad.addColorStop(1, '#DB2777');
          drawRoundRect(ctx, barX, rowY, fillW, barHeight, 10, barGrad);
        }

        ctx.fillStyle = item.count > 0 ? '#BE185D' : '#9CA3AF';
        ctx.font = 'bold 22px "Noto Sans TC", sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(`${item.count} 場`, 992, rowY + 16);
        ctx.textAlign = 'left';
      });

      const top5CardTop = yearCardBottom + 24;
      const top5CardHeight = 336;
      const top5TitleY = top5CardTop + 50;
      const top5ListStartY = top5CardTop + 92;

      drawRoundRect(ctx, 56, top5CardTop, 968, top5CardHeight, 26, '#FFFFFF', '#FBCFE8', 2);
      ctx.fillStyle = '#1F2937';
      ctx.font = 'bold 28px "Noto Sans TC", sans-serif';
      ctx.fillText('現場出現比例前五名（Top 5）', 88, top5TitleY);

      if (!data.top5 || data.top5.length === 0) {
        ctx.fillStyle = '#9CA3AF';
        ctx.font = '24px "Noto Sans TC", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('尚未加入參戰場次，加入後即可解鎖專屬 Top 5 榜單！', 540, top5CardTop + 188);
        ctx.textAlign = 'left';
      } else {
        data.top5.forEach((song, idx) => {
          const itemY = top5ListStartY + idx * 46;
          const badgeColors = ['#DB2777', '#EC4899', '#F472B6', '#F9A8D4', '#F9A8D4'];
          drawRoundRect(ctx, 88, itemY - 24, 36, 32, 10, badgeColors[idx]);
          ctx.fillStyle = '#FFFFFF';
          ctx.font = 'bold 20px "Noto Sans TC", sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(`${idx + 1}`, 106, itemY - 1);
          ctx.textAlign = 'left';

          ctx.fillStyle = '#1F2937';
          ctx.font = 'bold 24px "Noto Sans TC", sans-serif';
          drawTruncatedText(ctx, song.title, 140, itemY, 610);

          ctx.fillStyle = '#BE185D';
          ctx.font = 'bold 22px "Noto Sans TC", sans-serif';
          ctx.textAlign = 'right';
          ctx.fillText(song.metric, 992, itemY);
          ctx.textAlign = 'left';
        });
      }

      const top5CardBottom = top5CardTop + top5CardHeight;
      const footerY = top5CardBottom + 44;

      ctx.fillStyle = '#9D174D';
      ctx.font = '20px "Noto Sans TC", sans-serif';
      ctx.textAlign = 'center';
      const todayStr = new Date().toISOString().slice(0, 10);
      ctx.fillText(`櫻坂46 歷年歌單與參戰統計 ・ Generated on ${todayStr}`, 540, footerY);
      ctx.textAlign = 'left';

      currentReportDataUrl = canvas.toDataURL('image/png');
      return new Promise(resolve => {
        canvas.toBlob(blob => {
          currentReportBlob = blob;
          resolve(currentReportDataUrl);
        }, 'image/png');
      });
    }

    async function openShareReportModal() {
      const nicknameInput = document.getElementById('report-nickname-input');
      if (nicknameInput) {
        nicknameInput.value = getSavedNickname();
      }

      const dataUrl = await generateShareReportCanvas();
      const imgEl = document.getElementById('share-report-preview-img');
      if (imgEl) imgEl.src = dataUrl;

      const shareBtn = document.getElementById('native-share-btn');
      if (shareBtn && (!navigator.canShare || !currentReportBlob)) {
        shareBtn.style.display = 'none';
      } else if (shareBtn) {
        shareBtn.style.display = 'block';
      }

      const modal = document.getElementById('share-report-modal');
      if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
      }
    }

    function closeShareReportModal() {
      const modal = document.getElementById('share-report-modal');
      if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
      }
    }

    function downloadShareReportImage() {
      if (!currentReportDataUrl) return;
      const link = document.createElement('a');
      const dateTag = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      link.download = `sakurazaka46-live-report-${dateTag}.png`;
      link.href = currentReportDataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }

    async function nativeShareReportImage() {
      if (!currentReportBlob || !navigator.share) return;
      const file = new File([currentReportBlob], 'sakurazaka46-live-report.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            title: '我的櫻坂46 歷年參戰履歷',
            text: '來看看我的櫻坂46 現場參戰統計！',
            files: [file]
          });
        } catch (_err) {
          // 使用者取消分享時忽略錯誤
        }
      }
    }

    Object.assign(window, {
      switchTab,
      selectYear,
      selectCategory,
      onSeriesChange,
      toggleAttendedOnly,
      clearSearch,
      toggleAccordion,
      toggleAttendance,
      deleteCustomEvent,
      setSongSortMode,
      toggleShowAllRanking,
      toggleShowAllUnplayed,
      addUnplayedSong,
      removeUnplayedSong,
      openAddModal,
      closeAddModal,
      handleBackdropClick,
      syncYearFromDate,
      handleBgImageUpload,
      clearDraftBgImage,
      submitNewEvent,
      openEditModal,
      closeEditModal,
      handleEditBackdropClick,
      syncEditYearFromDate,
      submitEditEvent,
      revertBuiltinOverride,
      exportJsonData,
      importJsonData,
      resetAllUserData,
      shareAppLink,
      openAdminModal,
      closeAdminModal,
      handleAdminBackdropClick,
      submitAdminUnlock,
      exitAdminMode,
      exportStandaloneHtml,
      getSavedNickname,
      onNicknameInputChange,
      openShareReportModal,
      closeShareReportModal,
      downloadShareReportImage,
      nativeShareReportImage
    });

    document.addEventListener('DOMContentLoaded', function () {
      loadPersistedState();
      applyUrlShareParams();
      updateAdminUi();
      updateAttendedBadge();
      renderFilters();
      renderEvents();
      renderStats();
      initCloudSync();
    });
  
