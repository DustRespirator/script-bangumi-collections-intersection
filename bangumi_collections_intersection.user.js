// ==UserScript==
// @name         bgm.tv 收藏对比工具
// @namespace    https://github.com/DustRespirator
// @version      0.2
// @description  读取已登录用户与当前个人主页用户的收藏数据，显示共同喜好条目。仅基于页面DOM获取用户名。
// @author       Hoi
// @match        https://bgm.tv/user/*
// @grant        none
// ==/UserScript==

(function() {
    "use strict";

    // Fixed configuration
    const limit = 50;
    const myUsernameSelector = "#headerNeue2 .headerNeueInner.clearit .idBadgerNeue a.avatar";
    const friendUsernameSelector = "#headerProfile .subjectNav .headerContainer .nameSingle .headerAvatar a.avatar";

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

    // check cache expiry time with input user id
    function checkCacheExpiryTime(key) {
        const raw = localStorage.getItem(key);
        if (!raw) {
            return null;
        }
        try {
            const cache = JSON.parse(raw);
            if (cache.expiryTime <= Date.now()) {
                // console.log("Cache expired");
                localStorage.removeItem(key);
                return null;
            } else {
                // console.log("Use cache");
                return cache.collections;
            }
        } catch (error) {
            localStorage.removeItem(key); // usually issue on raw data
            console.error(error);
        }
    }

    // Fetch all collections for a given username or userid (if the user never sets a customized username)
    // We only fetch the subjects are "Done" and are rated at least 7 or not rated.
    // Source of algorithm: https://bgm.tv/group/topic/33344#post_676185
    async function fetchAllCollections(username) {
        // subject_type="" will search all types of subjects. Subjects type: 1 = Book (书籍), 2 = Anime (动画), 3 = Music (音乐), 4 = Game (游戏), 6 = Real (三次元), There is no 5
        // type=2 is "Done (看/读/听过)".
        // limit=50 is maximum allowed by the API
        // https://bangumi.github.io/api/#/%E6%94%B6%E8%97%8F/getUserCollectionsByUsername
        const baseUrl = `https://api.bgm.tv/v0/users/${username}/collections?subject_type=&type=2&limit=${limit}&offset=`;
        let total = 0;
        let offset = 0;
        let collections = [];
        let loop = true;

        // use cache for current login user
        if (username === getUsername(myUsernameSelector)) {
            const cache = checkCacheExpiryTime(username);
            if (cache) {
                return cache;
            }
        }

        try {
            while (loop) {
                const response = await fetch(baseUrl + offset);
                const jsonData = await response.json();

                if (offset === 0) {
                    total = jsonData.total; // first time running, get total subjects in the collections
                }
                // Only keep items that the rating is >= 7 or === 0 (no rating) by user
                const subjects = jsonData.data.filter(item => item.rate >= 7 || item.rate === 0).map(item => item.subject);
                collections.push(...subjects);

                // Continue fetching until we've gotten all items.
                if (offset + limit >= total) {
                    loop = false;
                } else {
                    offset = offset + limit;
                }
            }
            // cache expired after 1 hour
            const expiryTime = Date.now() + 3600 * 1000;
            const data = {
                collections,
                expiryTime
            };
            localStorage.setItem(username, JSON.stringify(data));
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

    // Create a toggle panel that displays the results
    function createOrTogglePanel(commonSubjects, myCount, friendCount) {
        const existing = document.getElementById("syncCollapsePanel");
        if (existing) {
            existing.hidden = !existing.hidden; // toggle fold/expand
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
        panel.style.background = "#f9f9f9";
        panel.style.border = "1px solid #ccc";
        panel.style.borderRadius = "6px";
        panel.style.padding = "10px";
        panel.style.boxShadow = "0 1px 4px rgba(0,0,0,0.1)";

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
            img.src = subject.images.small;
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
            createOrTogglePanel(intersection, myCollections.length, friendCollections.length);
        } catch (error) {
            hideLoading();
            alert("数据获取过程中出错");
            throw new Error(error);
        }
    }

    // Set the Synchronize panel as a clickable button to trigger the comparison
    function addTriggerButton() {
        const syncContainer = document.querySelector(".userSynchronize");
        if (!syncContainer) {
            console.error("Cannot find element with class 'userSynchronize'");
            return;
        }

        syncContainer.style.cursor = "pointer";
        // When the Synchronize panel is clicked, run the comparison process
        syncContainer.addEventListener("click", () => {
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
            await waitForElement(".userSynchronize");
            addTriggerButton();
        } catch (error) {
            console.error(error);
        }
    })();

})();
