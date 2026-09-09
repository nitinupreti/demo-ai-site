package com.demo.core.models;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.apache.sling.api.resource.Resource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;

import com.demo.core.testcontext.AppAemContext;

import io.wcm.testing.mock.aem.junit5.AemContext;
import io.wcm.testing.mock.aem.junit5.AemContextExtension;

@ExtendWith(AemContextExtension.class)
class CardGridModelTest {

    private final AemContext context = AppAemContext.newAemContext();

    @BeforeEach
    void setUp() {
        context.addModelsForClasses(CardGridModel.class, CardGridItemModel.class);
    }

    @Test
    void defaultsWhenEmpty() {
        Resource resource = context.create().resource("/content/card-grid");
        CardGridModel model = resource.adaptTo(CardGridModel.class);

        assertEquals("icon-cards", model.getStyle());
        assertTrue(model.getItems().isEmpty());
        assertFalse(model.isHasContent());
    }

    @Test
    void configuredFully() {
        Resource resource = context.create().resource("/content/card-grid", "title", "Courses", "description", "<p>Intro</p>", "style", "catalog");
        Resource items = context.create().resource(resource, "items");
        context.create().resource(items, "course", "title", "Course", "description", "<p>Copy</p>", "image", "/content/dam/course.png", "imageAlt", "Course image", "ctaLabel", "Explore", "ctaLink", "/courses", "tagline", "Design", "meta", "$450", "imageSide", "left");

        CardGridModel model = resource.adaptTo(CardGridModel.class);
        CardGridItemModel item = model.getItems().get(0);

        assertTrue(model.isHasContent());
        assertEquals("catalog", model.getStyle());
        assertEquals("Design", item.getTagline());
        assertEquals("$450", item.getMeta());
        assertEquals("left", item.getImageSide());
    }
}