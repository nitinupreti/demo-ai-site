package com.demo.core.models.ogs;

/**
 * News slide backing {@code ogs-news-carousel}.
 */
public class OgsNewsSlide {

    private final String title;
    private final String image;
    private final String description;
    private final String link;

    public OgsNewsSlide(String title, String image, String description, String link) {
        this.title = title;
        this.image = image;
        this.description = description;
        this.link = link;
    }

    public String getTitle() {
        return title;
    }

    public String getImage() {
        return image;
    }

    public String getDescription() {
        return description;
    }

    public String getLink() {
        return link;
    }
}
