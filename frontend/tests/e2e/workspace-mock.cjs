// In-memory server used by browser tests; never writes real user data.
module.exports = function workspaceMock(initial = [], resolvePlace = (id) => ({ place_id: id })) {
  let projects = initial;
  const saved = new Map();
  let nextId = 100;
  return async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (!/^\/api\/(projects|saved)\//.test(path)) return false;
    const method = request.method();
    const data = ["POST", "PATCH", "PUT"].includes(method) ? request.postDataJSON() : {};
    const reply = async (status, json) => {
      await route.fulfill(status === 204 ? { status } : { status, json });
      return true;
    };
    if (!request.headers().authorization) return reply(401, {});
    if (path === "/api/saved/") {
      if (method === "GET") return reply(200, [...saved.values()]);
      const place = resolvePlace(data.place_id);
      saved.set(place.place_id, place);
      return reply(201, place);
    }
    if (path.startsWith("/api/saved/")) {
      saved.delete(decodeURIComponent(path.split("/")[3]));
      return reply(204);
    }
    if (path === "/api/projects/") {
      if (method === "GET") return reply(200, projects);
      const project = { ...data, id: nextId++, places: (data.places || []).map((p) => ({
        ...resolvePlace(p.place_id), id: nextId++, notes: p.notes || "", visited: false,
      })) };
      projects.unshift(project);
      return reply(201, project);
    }
    const parts = path.split("/");
    const project = projects.find((p) => String(p.id) === parts[3]);
    if (!project) return reply(404, {});
    if (parts[4] === "places") {
      if (method === "POST") {
        const place = { ...resolvePlace(data.place_id), id: nextId++, notes: "", visited: false };
        project.places.push(place);
        return reply(201, place);
      }
      const place = project.places.find((p) => String(p.id) === parts[5]);
      return reply(200, place ? Object.assign(place, data) : data);
    }
    if (method === "DELETE") {
      projects = projects.filter((p) => p !== project);
      return reply(204);
    }
    return reply(200, Object.assign(project, data));
  };
};
