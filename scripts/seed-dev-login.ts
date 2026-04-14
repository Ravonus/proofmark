import { eq } from "drizzle-orm";
import { localhostDevLogin } from "~/server/auth/dev-localhost";

async function resetExistingUser() {
  const { db } = await import("~/server/db");
  const { users } = await import("~/server/db/schema");
  const [existingUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, localhostDevLogin.email))
    .limit(1);
  if (!existingUser) return false;

  await db.delete(users).where(eq(users.id, existingUser.id));
  return true;
}

async function seedDevLogin() {
  process.env.SMTP_HOST = "";
  process.env.SMTP_USER = "";
  process.env.SMTP_PASS = "";

  const { auth } = await import("~/server/auth/auth");
  const { db } = await import("~/server/db");
  const { users } = await import("~/server/db/schema");
  const removedExistingUser = await resetExistingUser();

  await auth.api.signUpEmail({
    body: {
      email: localhostDevLogin.email,
      password: localhostDevLogin.password,
      name: localhostDevLogin.name,
    },
  });

  await db
    .update(users)
    .set({
      emailVerified: true,
      updatedAt: new Date(),
    })
    .where(eq(users.email, localhostDevLogin.email));

  console.log(
    JSON.stringify(
      {
        email: localhostDevLogin.email,
        password: localhostDevLogin.password,
        name: localhostDevLogin.name,
        resetExistingUser: removedExistingUser,
      },
      null,
      2,
    ),
  );
}

seedDevLogin().catch((error) => {
  console.error(error);
  process.exit(1);
});
