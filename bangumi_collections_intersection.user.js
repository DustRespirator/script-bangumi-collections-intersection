// ==UserScript==
// @name         bgm.tv 收藏对比工具
// @namespace    https://github.com/DustRespirator
// @version      0.4
// @description  读取已登录用户与当前个人主页用户的收藏数据，显示共同喜好条目。仅基于页面DOM获取用户名。
// @author       Hoi
// @match        https://bgm.tv/user/*
// @grant        none
// ==/UserScript==

(function() {
    "use strict";

    // Fixed configuration
    const LIMIT = 50;
    const myUsernameSelector = "#headerNeue2 .headerNeueInner.clearit .idBadgerNeue a.avatar";
    const friendUsernameSelector = "#headerProfile .subjectNav .headerContainer .nameSingle .headerAvatar a.avatar";

    // Initialize cache if needed
    (function initCacheIfNeeded() {
        if (!localStorage.getItem("user_collections_cache")) {
            setFullCache({ cachedUsers: [], userData: {} });
        }
    })();

    // Extract username from a href ("/user/username" or "https://bgm.tv/user/username")
    function extractUsernameFromHref(href) {
        const match = href.match(/\/user\/([^\/]+)/);
        return match ? match[1] : null;
    }

    // Get "myUsername" from headerNeue2, Get the friend (current page owner) username from headerProfile
    function getUsername(selector) {
        const elem = document.querySelector(selector);
        if (elem && elem.href) {
            return extractUsernameFromHref(elem.href);
        }
        return null;
    }

    // Manage cache: get cache, if cache is corrupted, remove cache
    function getFullCache() {
        const raw = localStorage.getItem("user_collections_cache");
        if (!raw) {
            return { cachedUsers: [], userData: {} };
        }
        try {
            return JSON.parse(raw);
        } catch (error) {
            console.error("Corrupt cache. Clearing...");
            localStorage.removeItem("user_collections_cache");
            return { cachedUsers: [], userData: {} };
        }
    }

    // Manage cache: set cache
    function setFullCache(cache) {
        try {
            localStorage.setItem("user_collections_cache", JSON.stringify(cache));
        } catch (error) {
            console.error(error);
        }
    }

    // Fetch all collections for a given username or userid (if the user never sets a customized username)
    // We only fetch the subjects are "Done" and are rated at least 7 or not rated.
    // Source of algorithm: https://bgm.tv/group/topic/33344#post_676185
    async function fetchAllCollections(username) {
        // Search in the cache, if exist and not expired, use cache
        const cache = getFullCache();
        const cachedEntry = cache.userData?.[username];
        const currentUser = getUsername(myUsernameSelector);
        if (cachedEntry && cachedEntry.expiryTime > Date.now()) {
            return cachedEntry.collections;
        } else if (cachedEntry && cachedEntry.expiryTime <= Date.now()) {
        // Cache is expired, remove cache from cached users query and user data
            delete cache.userData[username];
            const index = cache.cachedUsers.indexOf(username);
            if (index !== -1) {
                cache.cachedUsers.splice(index, 1);
            }
        }

        // subject_type="" will search all types of subjects. Subjects type: 1 = Book (书籍), 2 = Anime (动画), 3 = Music (音乐), 4 = Game (游戏), 6 = Real (三次元), There is no 5
        // type=2 is "Done (看/读/听过)".
        // limit=50 is maximum allowed by the API
        // https://bangumi.github.io/api/#/%E6%94%B6%E8%97%8F/getUserCollectionsByUsername
        const baseUrl = `https://api.bgm.tv/v0/users/${username}/collections?subject_type=&type=2&limit=${LIMIT}&offset=`;
        let total = 0;
        let offset = 0;
        let collections = [];
        let loop = true;

        try {
            while (loop) {
                const response = await fetch(baseUrl + offset);
                const jsonData = await response.json();

                if (offset === 0) {
                    total = jsonData.total; // first time running, get total subjects in the collections
                }
                // Only keep items that the rating is >= 7 or === 0 (no rating) by user
                const subjects = jsonData.data.filter(item => item.rate >= 7 || item.rate === 0).map(item => ({
                    id: item.subject.id,
                    name: item.subject.name,
                    image: item.subject.images.small
                }));
                collections.push(...subjects);

                // Continue fetching until we've gotten all items.
                if (offset + LIMIT >= total) {
                    loop = false;
                } else {
                    offset += LIMIT;
                }
            }
            // Cache expired after 1 day
            const expiryTime = Date.now() + 3600 * 24 * 1000;
            cache.userData[username] = {
                collections,
                expiryTime
            };
            // Manage cached users query
            if (!cache.cachedUsers.includes(username)) {
                cache.cachedUsers.push(username);
            }
            // Limit of cache: 8 users
            while (cache.cachedUsers.length > 8) {
                const removed = cache.cachedUsers.find(user => user !== currentUser);
                cache.cachedUsers = cache.cachedUsers.filter(user => user !== removed);
                delete cache.userData[removed];
            }
            setFullCache(cache);
            return collections;
        } catch (error) {
            throw new Error(error);
        }
    }

    // Compare two arrays of subject objects based on subject.id.
    // Return a new array of subjects that appear in both.
    function computeIntersection(array1, array2) {
        const set = new Set(array1.map(subject => subject.id));
        return array2.filter(subject => set.has(subject.id));
    }

    // Create a panel that displays the results
    function createCollapsePanel(commonSubjects, myCount, friendCount) {
        const existing = document.getElementById("syncCollapsePanel");
        if (existing) {
            return;
        }

        const syncContainer = document.querySelector(".userSynchronize");
        if (!syncContainer) {
            console.error("Cannot find element with class 'userSynchronize'");
            return;
        }

        const panel = document.createElement("div");
        panel.id = "syncCollapsePanel";
        panel.style.marginTop = "10px";
        panel.style.background = "#FFF";
        panel.style.borderRadius = "5px";
        panel.style.paddingTop = "5px";
        panel.style.paddingRight = "10px";
        panel.style.paddingBottom = "5px";
        panel.style.paddingLeft = "10px";
        panel.style.boxShadow = "0 0 5px #DDD";

        const header = document.createElement("div");
        header.style.fontWeight = "bold";
        header.style.marginBottom = "6px";
        header.style.fontSize = "14px";
        header.textContent = `共同喜好 (${commonSubjects.length})`;
        panel.appendChild(header);

        const summary = document.createElement("div");
        summary.style.fontSize = "12px";
        summary.style.color = "#666";
        summary.style.marginBottom = "10px";
        summary.innerHTML = `我的收藏：${myCount} &nbsp;&nbsp; 对方收藏：${friendCount}`;
        panel.appendChild(summary);

        const grid = document.createElement("div");
        grid.style.display = "grid";
        grid.style.gridTemplateColumns = "repeat(auto-fill, 50px)";
        grid.style.gap = "6px";

        commonSubjects.forEach(subject => {
            const link = document.createElement("a");
            link.href = `https://bgm.tv/subject/${subject.id}`;
            link.target = "_blank";
            link.title = subject.name;

            const img = document.createElement("img");
            img.src = subject.image;
            img.alt = subject.name;
            Object.assign(img.style, {
                width: "50px",
                height: "auto",
                border: "1px solid #ccc",
                borderRadius: "3px"
            });

            link.appendChild(img);
            grid.appendChild(link);
        });

        panel.appendChild(grid);
        syncContainer.insertAdjacentElement("afterend", panel);
    }

    // Display or hide panel
    function toggleCollapsePanel() {
        const panel = document.getElementById("syncCollapsePanel");
        if (panel) {
            panel.hidden = !panel.hidden; // toggle panel
        }
    }

    // Show a loading indicator
    function showLoading() {
        let loader = document.getElementById("collectionLoader");
        if (!loader) {
            loader = document.createElement("span");
            loader.id = "collectionLoader";
            Object.assign(loader.style, {
                display: "inline-flex",
                lineHeight: "100%",
                alignItems: "center",
                marginLeft: "auto",
                fontSize: "11px",
                color: "#999"
            });

            const text = document.createElement("span");
            text.textContent = "加载中，请稍候";

            const ellipsis = document.createElement("span");
            ellipsis.className = "ellipsis";
            ellipsis.textContent = "...";
            loader.appendChild(text);
            loader.appendChild(ellipsis);

            const style = document.createElement("style");
            style.id = "ellipsisStyle";
            style.textContent = `
                @keyframes ellipsis {
                    from { width: 0; }
                    to { width: 3ch; }
                }
                .ellipsis {
                    display: inline-block;
                    overflow: hidden;
                    vertical-align: bottom;
                    width: 0;
                    animation: ellipsis 1.5s steps(6) infinite;
                }
            `;
            document.head.appendChild(style);

            const element = document.querySelector("small.hot");
            if (element) {
                element.insertAdjacentElement("afterend", loader);
            } else {
                console.error("Cannot find element with class 'hot'");
            }
        }
    }

    // Remove the loading indicator
    function hideLoading() {
        const loader = document.getElementById("collectionLoader");
        if (loader) {
            loader.remove();
        }
    }

    // Fetch and compare collections for both myUsername and friendUsername
    async function runComparison() {
        const myUsername = getUsername(myUsernameSelector);
        const friendUsername = getUsername(friendUsernameSelector);
        // console.log("My username:", myUsername);
        // console.log("Friend username:", friendUsername);
        if (!myUsername || !friendUsername) {
            alert("无法获取用户名");
            return;
        }

        showLoading();
        try {
            const myCollections = await fetchAllCollections(myUsername);
            const friendCollections = await fetchAllCollections(friendUsername);
            const intersection = computeIntersection(myCollections, friendCollections);
            hideLoading();
            createCollapsePanel(intersection, myCollections.length, friendCollections.length);
            const synchronizePanel = document.querySelector(".userSynchronize");
            synchronizePanel.style.cursor = "pointer";
            synchronizePanel.addEventListener("click", () => {
                toggleCollapsePanel();
            });
        } catch (error) {
            hideLoading();
            alert("数据获取过程中出错");
            throw new Error(error);
        }
    }

    // Add a button to trigger the main function
    function addTriggerButton() {
        // Skip current user or users without Synchronize panel
        if (!document.querySelector(".userSynchronize")) {
            return;
        }
        const actionsContainer = document.querySelector("#headerProfile .subjectNav .headerContainer .nameSingle .inner .actions");
        if (!actionsContainer) {
            console.error("Cannot find element with class 'actions'");
            return;
        }

        // If button is not exist, create a new button unless it is myself
        if (document.getElementById("getCommonSubjectsBtn")) {
            return;
        }

        const btn = document.createElement("a");
        btn.href = "javascript:void(0)";
        btn.id = "getCommonSubjectsBtn";
        btn.className = "chiiBtn";

        const span = document.createElement("span");
        span.textContent = "获取共同喜好";
        btn.appendChild(span);

        actionsContainer.appendChild(btn);

        // When the Synchronize panel is clicked, run the comparison process
        btn.addEventListener("click", () => {
            runComparison();
        });
    }

    // In case of try to add button before the element added
    async function waitForElement(selector) {
        const timeout = 5000;
        const start = performance.now();
        while (performance.now() - start < timeout) {
            const element = document.querySelector(selector);
            if (element) {
                return element;
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        throw new Error(`Timeout for waiting ${selector}`);
    }

    (async () => {
        try {
            await waitForElement(".actions");
            addTriggerButton();
        } catch (error) {
            console.error(error);
        }
    })();

})();
