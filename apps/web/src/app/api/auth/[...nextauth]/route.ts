import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { getDatabase, verifyPassword, type UserRecord } from "@boardmind/ai-core";

const authOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const db = getDatabase();
        const user = db
          .prepare(`SELECT * FROM users WHERE email = ? COLLATE NOCASE`)
          .get(credentials.email as string) as UserRecord | undefined;

        if (!user) return null;

        const valid = await verifyPassword(
          credentials.password as string,
          user.password_hash
        );

        if (!valid) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
        };
      },
    }),
  ],
  session: {
    strategy: "jwt" as const,
  },
  callbacks: {
    async jwt({ token, user }: any) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }: any) {
      if (session.user && token) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  secret: process.env.NEXTAUTH_SECRET || "boardmind-default-secret-key-32chars",
};

const handler = (NextAuth as any)(authOptions);

export { handler as GET, handler as POST };
