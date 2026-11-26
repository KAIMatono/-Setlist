    import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
    import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
    import { getFirestore, doc, getDoc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

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

        if (['2020', '2021', '2022', '2023', '2024', '2025', '2026'].includes(urlYear)) {
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

      const effectiveId = cloudBridge.activeProfileId || cloudBridge.authUser?.uid || '尚未連線';

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
          badge.textContent = '本機暫存（離線/未設定）';
          badge.className = 'px-2.5 py-0.5 rounded-full text-xs font-black bg-rose-50 text-[#C96A88] border border-[#F6DCE4]';
        }
      }

      if (summaryEl) {
        const timeText = cloudBridge.lastSyncedAt ? `（上次同步：${cloudBridge.lastSyncedAt}）` : '';
        summaryEl.textContent = `個人帳號 ID：${effectiveId} ${timeText}。歌單與新增場次會同步給大家；參戰紀錄僅限你的個人帳號跨裝置同步。`;
      }
    }

    function getPrivateUserDocRef(profileId) {
      if (!cloudBridge.db || !profileId) return null;
      return doc(cloudBridge.db, 'artifacts', cloudBridge.appId, 'users', String(profileId), 'sakurazaka_setlist', 'attendance');
    }

    function getSharedSetlistDocRef() {
      if (!cloudBridge.db) return null;
      const docKey = cloudBridge.sharedCatalogId || 'shared_catalog';
      return doc(cloudBridge.db, 'artifacts', cloudBridge.appId, 'public', 'data', 'sakurazaka_setlist', docKey);
    }

    function serializePrivateAttendance() {
      return {
        attendedIds: [...appState.attendedIds],
        extraUnplayedSongs: appState.extraUnplayedSongs,
        hiddenUnplayedKeys: [...appState.hiddenUnplayedKeys],
        updatedAt: new Date().toISOString()
      };
    }

    function serializeSharedSetlists() {
      return {
        customEvents: appState.customEvents,
        eventOverrides: appState.eventOverrides,
        updatedAt: new Date().toISOString()
      };
    }

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
        updateAttendedBadge();
        renderEvents();
        if (appState.activeTab === 'stats') {
          renderStats();
        }
        cloudBridge.lastSyncedAt = new Date().toLocaleTimeString('zh-Hant', { hour12: false });
        cloudBridge.syncState = 'synced';
        updateSyncUi();
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
        renderFilters();
        renderEvents();
        if (appState.activeTab === 'stats') {
          renderStats();
        }
        cloudBridge.lastSyncedAt = new Date().toLocaleTimeString('zh-Hant', { hour12: false });
        cloudBridge.syncState = 'synced';
        updateSyncUi();
      } finally {
        cloudBridge.isApplyingRemote = false;
      }
    }

    async function pushPrivateAttendanceToCloud(notifyUser = false) {
      if (cloudBridge.isApplyingRemote) return;
      if (!cloudBridge.authUser || !cloudBridge.db || !cloudBridge.activeProfileId) return;

      const docRef = getPrivateUserDocRef(cloudBridge.activeProfileId);
      if (!docRef) return;

      try {
        await setDoc(docRef, serializePrivateAttendance(), { merge: true });
        cloudBridge.lastSyncedAt = new Date().toLocaleTimeString('zh-Hant', { hour12: false });
        cloudBridge.syncState = 'synced';
        updateSyncUi();
        if (notifyUser) {
          showToast('已同步個人參戰與曲目紀錄');
        }
      } catch (_err) {
        cloudBridge.syncState = 'error';
        updateSyncUi();
        if (notifyUser) {
          showToast('雲端同步失敗，已保留本機紀錄');
        }
      }
    }

    async function pushSharedSetlistsToCloud(notifyUser = false) {
      if (cloudBridge.isApplyingRemote) return;
      if (!cloudBridge.authUser || !cloudBridge.db) return;

      const docRef = getSharedSetlistDocRef();
      if (!docRef) return;

      try {
        await setDoc(docRef, serializeSharedSetlists(), { merge: true });
        cloudBridge.lastSyncedAt = new Date().toLocaleTimeString('zh-Hant', { hour12: false });
        cloudBridge.syncState = 'synced';
        updateSyncUi();
        if (notifyUser) {
          showToast('已同步共用歌單更新');
        }
      } catch (_err) {
        cloudBridge.syncState = 'error';
        updateSyncUi();
        if (notifyUser) {
          showToast('共用歌單同步失敗，已保留本機修改');
        }
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
        if (snap.exists()) {
          applySharedSetlistPayload(snap.data());
        } else if (appState.customEvents.length > 0 || Object.keys(appState.eventOverrides).length > 0) {
          await setDoc(sharedRef, serializeSharedSetlists(), { merge: true });
        }
      } catch (_err) {
        cloudBridge.syncState = 'error';
        updateSyncUi();
      }

      cloudBridge.unsubscribeSharedDoc = onSnapshot(
        sharedRef,
        (snapshot) => {
          if (!snapshot.exists()) return;
          const remoteData = snapshot.data();
          const serializedLocal = JSON.stringify({
            customEvents: appState.customEvents,
            eventOverrides: appState.eventOverrides
          });
          const serializedRemote = JSON.stringify({
            customEvents: Array.isArray(remoteData.customEvents) ? remoteData.customEvents : [],
            eventOverrides: (remoteData.eventOverrides && typeof remoteData.eventOverrides === 'object') ? remoteData.eventOverrides : {}
          });

          if (serializedLocal !== serializedRemote) {
            applySharedSetlistPayload(remoteData);
          } else {
            cloudBridge.lastSyncedAt = new Date().toLocaleTimeString('zh-Hant', { hour12: false });
            cloudBridge.syncState = 'synced';
            updateSyncUi();
          }
        },
        (_err) => {
          cloudBridge.syncState = 'error';
          updateSyncUi();
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
        if (snap.exists()) {
          applyPrivateAttendancePayload(snap.data());
        } else {
          await setDoc(docRef, serializePrivateAttendance(), { merge: true });
          cloudBridge.lastSyncedAt = new Date().toLocaleTimeString('zh-Hant', { hour12: false });
          cloudBridge.syncState = 'synced';
          updateSyncUi();
        }
      } catch (_err) {
        cloudBridge.syncState = 'error';
        updateSyncUi();
      }

      cloudBridge.unsubscribePrivateDoc = onSnapshot(
        docRef,
        (snapshot) => {
          if (!snapshot.exists()) return;
          const remoteData = snapshot.data();
          const serializedLocal = JSON.stringify([...appState.attendedIds].sort());
          const serializedRemote = JSON.stringify((Array.isArray(remoteData.attendedIds) ? remoteData.attendedIds.map(String) : []).sort());

          if (serializedLocal !== serializedRemote) {
            applyPrivateAttendancePayload(remoteData);
          } else {
            cloudBridge.lastSyncedAt = new Date().toLocaleTimeString('zh-Hant', { hour12: false });
            cloudBridge.syncState = 'synced';
            updateSyncUi();
          }
        },
        (_err) => {
          cloudBridge.syncState = 'error';
          updateSyncUi();
        }
      );
    }

    async function initCloudSync() {
      if (typeof __firebase_config === 'undefined' || !__firebase_config) {
        cloudBridge.syncState = 'offline';
        updateSyncUi();
        return;
      }

      try {
        const firebaseConfig = JSON.parse(__firebase_config);
        const app = initializeApp(firebaseConfig);
        cloudBridge.auth = getAuth(app);
        cloudBridge.db = getFirestore(app);

        onAuthStateChanged(cloudBridge.auth, async (user) => {
          cloudBridge.authUser = user;
          if (!user) {
            cloudBridge.syncState = 'offline';
            updateSyncUi();
            return;
          }
          const savedAlias = safeReadStorage(STORAGE_KEY_PROFILE_ALIAS, '');
          const targetProfileId = savedAlias && String(savedAlias).trim()
            ? String(savedAlias).trim()
            : user.uid;
          await subscribeToProfile(targetProfileId);
        });

        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(cloudBridge.auth, __initial_auth_token);
        } else {
          await signInAnonymously(cloudBridge.auth);
        }
      } catch (_err) {
        cloudBridge.syncState = 'offline';
        updateSyncUi();
      }
    }

    window.openAccountModal = function () {
      const modal = document.getElementById('account-modal');
      const input = document.getElementById('cross-device-id-input');
      if (input) {
        input.value = cloudBridge.activeProfileId || '';
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
      const idText = cloudBridge.activeProfileId || cloudBridge.authUser?.uid || '';
      if (!idText) {
        showToast('目前尚無可用帳號 ID');
        return;
      }
      const tempInput = document.createElement('textarea');
      tempInput.value = idText;
      document.body.appendChild(tempInput);
      tempInput.select();
      try {
        document.execCommand('copy');
        showToast('已複製完整帳號 ID');
      } catch (_err) {
        showToast('複製失敗，請手動選取複製');
      } finally {
        tempInput.remove();
      }
    };

    window.switchCrossDeviceProfile = async function (e) {
      e.preventDefault();
      const input = document.getElementById('cross-device-id-input');
      const nextId = String(input?.value || '').trim().replace(/[\/#?\[\]]/g, '_');
      if (!nextId) {
        showToast('請輸入有效的帳號 ID 或個人空間代碼');
        return;
      }
      safeWriteStorage(STORAGE_KEY_PROFILE_ALIAS, nextId);
      cloudBridge.syncState = 'connecting';
      await subscribeToProfile(nextId);
      window.closeAccountModal();
      showToast(`已切換至個人空間：${nextId}`);
    };

    window.createNewAnonymousProfile = async function () {
      const freshId = `buddy-${crypto.randomUUID()}`;
      safeWriteStorage(STORAGE_KEY_PROFILE_ALIAS, freshId);
      const input = document.getElementById('cross-device-id-input');
      if (input) input.value = freshId;
      cloudBridge.syncState = 'connecting';
      await subscribeToProfile(freshId);
      showToast('已建立新的獨立帳號 ID');
    };

    window.syncNowToCloud = async function (notifyUser = true) {
      await Promise.all([
        pushSharedSetlistsToCloud(false),
        pushPrivateAttendanceToCloud(false)
      ]);
      if (notifyUser) {
        showToast('已完成共用歌單與個人參戰同步');
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

    function renderFilters() {
      const years = ['ALL', '2020', '2021', '2022', '2023', '2024', '2025', '2026'];
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
      for (const y of ['2020', '2021', '2022', '2023', '2024', '2025', '2026']) {
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
      exportStandaloneHtml
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
  
