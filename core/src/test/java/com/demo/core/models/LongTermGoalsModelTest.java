/*
 * Copyright 2024 Adobe Systems Incorporated
 * Licensed under the Apache License, Version 2.0
 */
package com.demo.core.models;

import static org.junit.jupiter.api.Assertions.*;

import org.apache.sling.api.resource.Resource;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;

import com.demo.core.testcontext.AppAemContext;

import io.wcm.testing.mock.aem.junit5.AemContext;
import io.wcm.testing.mock.aem.junit5.AemContextExtension;

@ExtendWith(AemContextExtension.class)
class LongTermGoalsModelTest {

    private final AemContext ctx = AppAemContext.newAemContext();

    @Test
    void defaultsWhenEmpty() {
        Resource res = ctx.create().resource("/content/ltg-empty",
                "sling:resourceType", "demo-ai-site/components/long-term-goals");
        LongTermGoalsModel m = res.adaptTo(LongTermGoalsModel.class);
        assertFalse(m.isHasContent());
        assertNull(m.getHeading());
        assertTrue(m.getGoals().isEmpty());
    }

    @Test
    void configuredFully() {
        Resource root = ctx.create().resource("/content/ltg",
                "sling:resourceType", "demo-ai-site/components/long-term-goals",
                "eyebrow", "LONG-TERM DANAHER GOALS WE SUPPORT",
                "heading", "Empowering change with environmentally conscious design",
                "description", "<p>Our HQ leads sustainability.</p>",
                "image", "/content/dam/example.png",
                "imageAlt", "map",
                "checkIcon", "/content/dam/check.svg");
        Resource goals = ctx.create().resource(root, "goals");
        ctx.create().resource(goals, "item0", "text", "Net-zero by 2050");
        ctx.create().resource(goals, "item1", "text", "50.4% reduction by 2032");
        ctx.create().resource(goals, "item2", "text", "");

        LongTermGoalsModel m = root.adaptTo(LongTermGoalsModel.class);
        assertTrue(m.isHasContent());
        assertEquals("Empowering change with environmentally conscious design", m.getHeading());
        assertEquals("Net-zero by 2050", m.getGoals().get(0).getText());
        assertEquals(2, m.getGoals().size());
        assertEquals("/content/dam/check.svg", m.getCheckIcon());
    }
}
