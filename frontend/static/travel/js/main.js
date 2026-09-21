import { $ } from "travel/core/dom.js";
import { initActions, registerActions } from "travel/core/actions.js";
import { initModal, modal, closeModal } from "travel/ui/modal.js";
import { initPlaces } from "travel/components/places.js";
import { initAccount } from "travel/account.js";
import { initDiscover } from "travel/pages/discover.js";
import { initTrips } from "travel/pages/trips.js";
import { initSaved } from "travel/pages/saved.js";
import { route, navigate } from "travel/router.js";

initActions();
initModal();
initPlaces();
initAccount();
initDiscover();
initTrips();
initSaved();
registerActions({
  close: () => closeModal(),
  explore: () => {
    if (modal.open) closeModal();
    navigate("collection");
  },
  "back-top": () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    $("#main").focus({ preventScroll: true });
  },
});
window.addEventListener("hashchange", route);
route();
