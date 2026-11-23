CREATE TABLE "qualification_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"question_text" text NOT NULL,
	"answer" text NOT NULL,
	"answered_by" uuid,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qualification_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"text" text NOT NULL,
	"allow_na" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "qualification_uau_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "qualification_answers" ADD CONSTRAINT "qualification_answers_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualification_answers" ADD CONSTRAINT "qualification_answers_question_id_qualification_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."qualification_questions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualification_answers" ADD CONSTRAINT "qualification_answers_answered_by_users_id_fk" FOREIGN KEY ("answered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "qualification_answers_request_question_idx" ON "qualification_answers" USING btree ("request_id","question_id");--> statement-breakpoint
-- Perguntas iniciais (as do questionário QUALIFOR do UAU); editáveis no Painel dev
INSERT INTO "qualification_questions" ("text", "allow_na", "sort") VALUES
('Material/Serviço controlado?', false, 1),
('Empresa com mais de 2 anos de atuação no mercado?', false, 2),
('Qualificação positiva do fornecedor segundo as referências consultadas?', false, 3),
('Tempo de retorno adequado?', false, 4),
('Empresa qualificada pelo PSQ?', true, 5),
('Possui certificados de qualidade?', true, 6),
('Atende aos requisitos da norma de desempenho - NBR 15.575?', true, 7),
('Apresentou todos os laudos/licenças quando solicitado?', true, 8);
