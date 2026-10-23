export function SignOut() {
  return (
    <form action="/api/auth/logout" method="post">
      <button className="btn-secondary" type="submit">
        Sign out
      </button>
    </form>
  );
}
