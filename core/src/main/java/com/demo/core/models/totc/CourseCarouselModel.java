package com.demo.core.models.totc;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import javax.annotation.PostConstruct;

import org.apache.commons.lang3.StringUtils;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.Default;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ChildResource;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class CourseCarouselModel {

    @ValueMapValue private String categoryLabel;
    @ValueMapValue @Default(values = "palette") private String categoryIcon;

    @ValueMapValue @Default(values = "SEE ALL") private String seeAllLabel;
    @ValueMapValue private String seeAllLink;

    @ValueMapValue private String featuredTitle;
    @ValueMapValue private String featuredSubtitle;
    @ValueMapValue private String featuredImage;
    @ValueMapValue private String featuredPrice;
    @ValueMapValue @Default(values = "EXPLORE") private String featuredCta;
    @ValueMapValue @Default(intValues = 6) private int featuredPosition;

    @ChildResource
    private List<Book> books;

    @PostConstruct
    protected void init() {
        if (books == null) {
            books = Collections.emptyList();
        } else {
            List<Book> filtered = new ArrayList<>();
            for (Book b : books) {
                if (b != null && b.hasContent()) {
                    filtered.add(b);
                }
            }
            books = Collections.unmodifiableList(filtered);
        }
    }

    public String getCategoryLabel() { return categoryLabel; }
    public String getCategoryIcon() { return categoryIcon; }
    public String getSeeAllLabel() { return seeAllLabel; }
    public String getSeeAllLink() { return seeAllLink; }
    public String getFeaturedTitle() { return featuredTitle; }
    public String getFeaturedSubtitle() { return featuredSubtitle; }
    public String getFeaturedImage() { return featuredImage; }
    public String getFeaturedPrice() { return featuredPrice; }
    public String getFeaturedCta() { return featuredCta; }
    public int getFeaturedPosition() { return featuredPosition; }
    public List<Book> getBooks() { return books; }

    public boolean isHasContent() {
        return StringUtils.isNotBlank(categoryLabel) || !books.isEmpty();
    }

    @Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
    public static class Book {
        @ValueMapValue private String title;
        @ValueMapValue @Default(values = "orange") private String color;

        public String getTitle() { return title; }
        public String getColor() { return color; }

        public boolean hasContent() { return true; }
    }
}
